import { Hono } from "hono";
import type { AppEnv } from "../app.js";

/** Instagram / WhatsApp 的 webhook 入口。先把验证握手做了，消息处理在 channels/ 里补 */
export const webhookRoutes = new Hono<AppEnv>();

webhookRoutes.get("/whatsapp", (c) => {
  const q = c.req.query();
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) return c.text(q["hub.challenge"] ?? "");
  return c.text("forbidden", 403);
});
webhookRoutes.post("/whatsapp", async (c) => {
  // TODO: 验签、翻译成 InboundMessage、handleInbound、回消息
  return c.json({ received: true });
});

webhookRoutes.get("/instagram", (c) => {
  const q = c.req.query();
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === process.env.INSTAGRAM_VERIFY_TOKEN) return c.text(q["hub.challenge"] ?? "");
  return c.text("forbidden", 403);
});
webhookRoutes.post("/instagram", async (c) => {
  return c.json({ received: true });
});
