import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGateway, defaultTools, consoleTraceSink, parseShopConfig,
  InMemoryBookingStore, InMemoryCalendar, InMemoryShopRepo, Tracer,
  type BookingStore, type ConversationStore, type CorrectionStore, type Gateway, type ShopConfig, type ShopRepo, type TraceSink,
} from "@fluffdesk/core";
import { createDb, PgBookingStore, PgConversationStore, PgCorrectionStore, PgShopRepo, pgTraceSink } from "@fluffdesk/db";
import { MemoryConversationStore, MemoryCorrectionStore } from "./memory.js";
import { RateLimiter } from "./ratelimit.js";

/**
 * 进程级依赖。路由和渠道层只认这里的接口。
 * 存储按 DATABASE_URL 切换：配了走 Neon（@fluffdesk/db），没配走内存版（开发、测试、Docker 冒烟）。
 * 生产环境没配就起不来，不能默默退回内存把客人的会话丢掉。
 */
export interface Runtime {
  gateway: Gateway;
  shops: ShopRepo;
  conversations: ConversationStore;
  bookings: BookingStore;
  corrections: CorrectionStore;
  limits: { perIp: RateLimiter; perSession: RateLimiter };
  traceSinks: TraceSink[];
  newTracer(conversationId: string): Tracer;
  calendarFor(shop: ShopConfig): InMemoryCalendar;
  tools: ReturnType<typeof defaultTools>;
  /** 关连接池。进程退出前调 */
  close(): Promise<void>;
}

interface Persistence {
  shops: ShopRepo;
  conversations: ConversationStore;
  bookings: BookingStore;
  corrections: CorrectionStore;
  traceSinks: TraceSink[];
  close(): Promise<void>;
}

export function createRuntime(env: Record<string, string | undefined> = process.env): Runtime {
  const url = env.DATABASE_URL;
  if (!url && env.NODE_ENV === "production") throw new Error("DATABASE_URL must be set in production");
  const persistence = url ? pgPersistence(url) : memoryPersistence();
  return {
    gateway: createGateway(),
    ...persistence,
    limits: { perIp: new RateLimiter(60, 60_000), perSession: new RateLimiter(20, 60_000) },
    newTracer: (id) => new Tracer(id, persistence.traceSinks),
    calendarFor: (shop) =>
      new InMemoryCalendar((date) => {
        const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T00:00:00`).getDay()] as keyof ShopConfig["hours"];
        return shop.hours[day] ?? null;
      }),
    tools: defaultTools(),
  };
}

function pgPersistence(url: string): Persistence {
  const db = createDb(url);
  console.log(`[runtime] storage: postgres host=${new URL(url).host}`);
  return {
    shops: new PgShopRepo(db),
    conversations: new PgConversationStore(db),
    bookings: new PgBookingStore(db),
    corrections: new PgCorrectionStore(db),
    traceSinks: [consoleTraceSink, pgTraceSink(db)],
    close: () => db.$client.end(),
  };
}

/** 店铺从 eval 数据集的 demo 店读；会话最多 5000 个、24 小时没动就丢，公网 sessionId 是客人自己定的，不能无限收 */
function memoryPersistence(): Persistence {
  console.warn("[runtime] DATABASE_URL not set: using in-memory storage, everything is lost on restart");
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(resolve(here, "../../../packages/eval/datasets/shops.json"), "utf8")) as Record<string, unknown>;
  return {
    shops: new InMemoryShopRepo(Object.values(raw).map(parseShopConfig)),
    conversations: new MemoryConversationStore(),
    bookings: new InMemoryBookingStore(),
    corrections: new MemoryCorrectionStore(),
    traceSinks: [consoleTraceSink],
    close: async () => {},
  };
}
