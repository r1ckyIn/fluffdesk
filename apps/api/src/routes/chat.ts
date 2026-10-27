import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { handleInbound } from "../channels/base.js";

/** 托管聊天页和嵌入小窗共用的接口。前端带 sessionId，服务端按店铺+渠道+session 找会话 */
export const chatRoutes = new Hono<AppEnv>();

chatRoutes.post("/:shop", async (c) => {
  const body = await c.req.json<{ sessionId: string; text?: string; images?: Array<{ data: string; mimeType: string }>; channel?: "web" | "embed" }>();
  if (!body.sessionId) return c.json({ error: "sessionId required" }, 400);
  if (!body.text && !body.images?.length) return c.json({ error: "text or images required" }, 400);
  try {
    const result = await handleInbound(c.get("rt"), {
      shopSlug: c.req.param("shop"),
      channel: body.channel ?? "web",
      externalId: body.sessionId,
      input: { text: body.text, images: body.images },
    });
    return c.json({ reply: result.reply, stop: result.stop, traceId: result.traceId });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});
