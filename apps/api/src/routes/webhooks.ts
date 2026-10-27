import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { AppEnv } from "../app.js";

/** Instagram / WhatsApp 的 webhook 入口。先把验证握手做了，消息处理在 channels/ 里补 */
export const webhookRoutes = new Hono<AppEnv>();

/** 环境变量没配就一律拒绝，不能让 undefined === undefined 把挑战码回出去 */
export function verifyTokenMatches(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function handshake(envName: string) {
  return (c: Context<AppEnv>) => {
    const q = c.req.query();
    if (q["hub.mode"] === "subscribe" && verifyTokenMatches(process.env[envName], q["hub.verify_token"])) return c.text(q["hub.challenge"] ?? "");
    return c.text("forbidden", 403);
  };
}

webhookRoutes.get("/whatsapp", handshake("WHATSAPP_VERIFY_TOKEN"));
webhookRoutes.post("/whatsapp", async (c) => {
  // TODO: 验签（X-Hub-Signature-256）、翻译成 InboundMessage、handleInbound、回消息
  return c.json({ received: true });
});

webhookRoutes.get("/instagram", handshake("INSTAGRAM_VERIFY_TOKEN"));
webhookRoutes.post("/instagram", async (c) => {
  return c.json({ received: true });
});
