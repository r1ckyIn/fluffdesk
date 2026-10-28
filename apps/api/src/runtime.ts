import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGateway, defaultTools, consoleTraceSink, validateShopConfig, bookingSlot,
  InMemoryBookingStore, InMemoryCalendar, InMemoryShopRepo, Tracer,
  type BookingStore, type ConversationStore, type CorrectionStore, type Gateway, type ShopConfig, type ShopEditor, type ShopRepo, type TraceSink,
} from "@fluffdesk/core";
import { createDb, PgBookingStore, PgConversationStore, PgCorrectionStore, PgShopRepo, pgTraceSink } from "@fluffdesk/db";
import { MemoryConversationStore, MemoryCorrectionStore } from "./memory.js";
import { RateLimiter } from "./ratelimit.js";

/**
 * 进程级依赖。路由和渠道层只认这里的接口。
 * 存储按 DATABASE_URL 切换：配了走 Neon（@fluffdesk/db），没配走内存版（本地开发和测试）。
 * 生产环境没配就起不来，不能默默退回内存把客人的会话丢掉。
 */
export interface Runtime {
  gateway: Gateway;
  /** 写口只有美容师端的路由用；agent 循环拿到的是 ShopConfig 本身，碰不到仓库 */
  shops: ShopRepo & ShopEditor;
  conversations: ConversationStore;
  bookings: BookingStore;
  corrections: CorrectionStore;
  /**
   * perIp / perSession 是公网聊天的预算。美容师端一次操作就十来个请求，不能和它共用：
   * groomerIp 给已鉴权的正常使用，groomerAuth 只数鉴权失败，猜令牌的那条路还是窄的
   */
  limits: { perIp: RateLimiter; perSession: RateLimiter; groomerIp: RateLimiter; groomerAuth: RateLimiter; groomerAuthAll: RateLimiter };
  traceSinks: TraceSink[];
  newTracer(conversationId: string): Tracer;
  calendarFor(shop: ShopConfig): InMemoryCalendar;
  tools: ReturnType<typeof defaultTools>;
  /** 停后台任务、关连接池。进程退出前调 */
  close(): Promise<void>;
}

type Persistence = Pick<Runtime, "shops" | "conversations" | "bookings" | "corrections" | "traceSinks" | "close">;

/** 图片在会话闲置多久后清掉：和内存版的会话 TTL 一样。文字历史留着做 eval，图片只在聊天进行中有用 */
const IMAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const IMAGE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export function createRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const url = env.DATABASE_URL;
  if (!url && env.NODE_ENV === "production") throw new Error("DATABASE_URL must be set in production");
  const persistence = url ? pgPersistence(url) : memoryPersistence();
  return {
    gateway: createGateway(),
    ...persistence,
    limits: { perIp: new RateLimiter(60, 60_000), perSession: new RateLimiter(20, 60_000), groomerIp: new RateLimiter(600, 60_000), groomerAuth: new RateLimiter(10, 60_000), groomerAuthAll: new RateLimiter(100, 60_000) },
    newTracer: (id) => new Tracer(id, persistence.traceSinks),
    // 日历 = 营业时间减掉已确认的预约：美容师点了确认，agent 和替代时段选择器就都看不到那个空档了
    calendarFor: (shop) =>
      new InMemoryCalendar(
        (date) => {
          const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T00:00:00`).getDay()] as keyof ShopConfig["hours"];
          return shop.hours[day] ?? null;
        },
        async (date) => (await persistence.bookings.listConfirmedOn(shop.slug, date)).map(bookingSlot),
      ),
    tools: defaultTools(),
  };
}

function pgPersistence(url: string): Persistence {
  const db = createDb(url);
  console.log(`[runtime] storage: postgres host=${new URL(url).host}`);
  const conversations = new PgConversationStore(db);
  // 公网来的 sessionId 不能无限收图：闲置会话的图片定期清掉，启动时先扫一次
  const sweep = () =>
    conversations
      .expireIdleImages(new Date(Date.now() - IMAGE_RETENTION_MS))
      .then((n) => n > 0 && console.log(`[runtime] expired images of ${n} idle conversation(s)`))
      .catch((e: unknown) => console.error(`[runtime] image sweep failed: ${(e as Error).message}`));
  void sweep();
  const timer = setInterval(sweep, IMAGE_SWEEP_INTERVAL_MS);
  timer.unref();
  return {
    shops: new PgShopRepo(db),
    conversations,
    bookings: new PgBookingStore(db),
    corrections: new PgCorrectionStore(db),
    traceSinks: [consoleTraceSink, pgTraceSink(db)],
    close: async () => {
      clearInterval(timer);
      await db.$client.end();
    },
  };
}

/** 店铺从 eval 数据集的 demo 店读；会话最多 5000 个、24 小时没动就丢 */
function memoryPersistence(): Persistence {
  console.warn("[runtime] DATABASE_URL not set: using in-memory storage, everything is lost on restart");
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(resolve(here, "../../../packages/eval/datasets/shops.json"), "utf8")) as Record<string, unknown>;
  return {
    shops: new InMemoryShopRepo(Object.values(raw).map(validateShopConfig)),
    conversations: new MemoryConversationStore(),
    bookings: new InMemoryBookingStore(),
    corrections: new MemoryCorrectionStore(),
    traceSinks: [consoleTraceSink],
    close: async () => {},
  };
}
