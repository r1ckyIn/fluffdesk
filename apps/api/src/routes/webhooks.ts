import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { AppEnv } from "../app.js";
import { metaDeps, verifyMetaSignature, type MetaDeps } from "../channels/meta.js";
import { createWhatsAppChannel } from "../channels/whatsapp.js";

/** 环境变量没配就一律拒绝，不能让 undefined === undefined 把挑战码回出去 */
export function verifyTokenMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function handshake(expected: string | undefined) {
  return (c: Context<AppEnv>) => {
    const q = c.req.query();
    if (q["hub.mode"] === "subscribe" && verifyTokenMatches(expected, q["hub.verify_token"])) return c.text(q["hub.challenge"] ?? "");
    return c.text("forbidden", 403);
  };
}

export interface WebhookDeps extends Partial<MetaDeps> {
  /**
   * 收到的消息在后台处理：Meta 要求几秒内回 200，模型一轮要十几秒，不回就会重发。
   * 默认只记错误；测试里换成收集 promise 的函数，好等处理完再断言
   */
  track?: (p: Promise<void>) => void;
}

const defaultTrack = (p: Promise<void>) => void p.catch((e: unknown) => console.error(`[webhooks] ${(e as Error).message}`));

/** Instagram / WhatsApp 的 webhook 入口。配置只从 createApp 给的 config 读 */
export function webhookRoutes(config: Record<string, string | undefined>, deps: WebhookDeps = {}): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const track = deps.track ?? defaultTrack;
  const meta = metaDeps(config, deps);
  const secret = config.META_APP_SECRET;
  const whatsapp = createWhatsAppChannel(config, meta);
  // 没有 secret 验不了签，没有 token 回不了话：少一样整条路由 503，不能收了消息又没法处理
  const whatsappReady = Boolean(secret && config.WHATSAPP_ACCESS_TOKEN);

  routes.get("/whatsapp", handshake(config.WHATSAPP_VERIFY_TOKEN));
  routes.post("/whatsapp", async (c) => {
    if (!whatsappReady) return c.json({ error: "whatsapp not configured" }, 503);
    // 验签要拿原始字节算，先 text 再 parse
    const raw = await c.req.text();
    if (!verifyMetaSignature(secret, raw, c.req.header("x-hub-signature-256"))) return c.json({ error: "bad signature" }, 401);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    track(whatsapp.handle(c.get("rt"), payload));
    return c.json({ received: true });
  });

  routes.get("/instagram", handshake(config.INSTAGRAM_VERIFY_TOKEN));
  routes.post("/instagram", async (c) => {
    return c.json({ received: true });
  });
  return routes;
}
