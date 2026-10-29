import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { AppEnv } from "../app.js";
import type { MetaChannel } from "../channels/inbound.js";
import { createInstagramChannel } from "../channels/instagram.js";
import { metaDeps, verifyMetaSignature, type MetaDeps } from "../channels/meta.js";
import { createWhatsAppChannel } from "../channels/whatsapp.js";
import { clientIp } from "./chat.js";

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

/** 出网的 fetch、DNS 解析和 Graph 地址，测试里换成假的 */
export type WebhookDeps = Partial<MetaDeps>;

interface MetaWebhook {
  name: string;
  verifyToken: string | undefined;
  /** 没有 secret 验不了签，没有 token 回不了话：少一样整条路由 503，不能收了消息又没法处理 */
  ready: boolean;
  channel: MetaChannel;
}

/**
 * Meta 两个产品的 webhook 入口长得一样：GET 握手，POST 先每 IP 限流、再 503/验签/解析，然后先回 200 后台处理。
 * 配置只从 createApp 给的 config 读
 */
export function webhookRoutes(config: Record<string, string | undefined>, deps: WebhookDeps = {}): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const meta = metaDeps(config, deps);
  const secret = config.META_APP_SECRET;
  const hooks: MetaWebhook[] = [
    { name: "whatsapp", verifyToken: config.WHATSAPP_VERIFY_TOKEN, ready: Boolean(secret && config.WHATSAPP_ACCESS_TOKEN), channel: createWhatsAppChannel(config, meta) },
    { name: "instagram", verifyToken: config.INSTAGRAM_VERIFY_TOKEN, ready: Boolean(secret && config.INSTAGRAM_ACCESS_TOKEN), channel: createInstagramChannel(config, meta) },
  ];

  for (const hook of hooks) {
    routes.get(`/${hook.name}`, handshake(hook.verifyToken));
    routes.post(`/${hook.name}`, async (c) => {
      const rt = c.get("rt");
      // 公网入口都有每 IP 上限（CLAUDE.md）。没签名的请求也要先读完请求体才能验签，所以限流在读体之前。
      // 预算比聊天宽：正常来源只有 Meta 的几个出口 IP，一次投递可能带好几条消息。
      // 两个产品从同一批出口 IP 来，各算各的，一个产品补投积压不能把另一个挤成 429
      if (!rt.limits.webhookIp.take(`${hook.name}:${clientIp(c)}`)) return c.json({ error: "too many requests" }, 429);
      if (!hook.ready) return c.json({ error: `${hook.name} not configured` }, 503);
      // 验签要拿原始字节算，先 text 再 parse
      const raw = await c.req.text();
      if (!verifyMetaSignature(secret, raw, c.req.header("x-hub-signature-256"))) return c.json({ error: "bad signature" }, 401);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return c.json({ error: "invalid json" }, 400);
      }
      // Meta 要求几秒内回 200，模型一轮要十几秒：先回，处理放后台，关停时 rt.close() 会等它跑完
      rt.background.track(hook.channel.handle(rt, payload));
      return c.json({ received: true });
    });
  }
  return routes;
}
