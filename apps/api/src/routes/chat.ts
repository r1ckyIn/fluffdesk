import { Hono, type Context } from "hono";
import { IMAGE_MIME_ALLOWLIST, LIMITS } from "@fluffdesk/core";
import type { AppEnv } from "../app.js";
import { handleInbound } from "../channels/base.js";

/** 托管聊天页和嵌入小窗共用的接口。前端带 sessionId，服务端按店铺+渠道+session 找会话 */
export const chatRoutes = new Hono<AppEnv>();

/** Fly 会填 fly-client-ip；本地或别的反代用 x-forwarded-for 的第一跳 */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("fly-client-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

interface ChatBody {
  sessionId?: unknown;
  text?: unknown;
  images?: unknown;
  channel?: unknown;
}

chatRoutes.post("/:shop", async (c) => {
  const rt = c.get("rt");
  if (!rt.limits.perIp.take(clientIp(c))) return c.json({ error: "too many requests" }, 429);

  let body: ChatBody;
  try {
    body = await c.req.json<ChatBody>();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (typeof body.sessionId !== "string" || !SESSION_ID.test(body.sessionId)) return c.json({ error: "sessionId must be 8-64 chars [A-Za-z0-9_-]" }, 400);
  if (!rt.limits.perSession.take(body.sessionId)) return c.json({ error: "too many requests" }, 429);

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > LIMITS.textChars) return c.json({ error: `text must be at most ${LIMITS.textChars} chars` }, 400);
  const images = validateImages(body.images);
  if (images === "invalid") return c.json({ error: `images: at most ${LIMITS.imagesPerTurn}, types ${[...IMAGE_MIME_ALLOWLIST].join("/")}, base64 <= ${LIMITS.imageBase64Bytes} bytes` }, 400);
  if (!text && images.length === 0) return c.json({ error: "text or images required" }, 400);
  const channel = body.channel === "embed" ? "embed" : "web";

  const shop = rt.shops.get(c.req.param("shop"));
  if (!shop) return c.json({ error: "unknown shop" }, 404);

  const result = await handleInbound(rt, { shopSlug: shop.slug, channel, externalId: body.sessionId, input: { text: text || undefined, images } });
  return c.json({ reply: result.reply, stop: result.stop, traceId: result.traceId });
});

export function validateImages(raw: unknown): Array<{ data: string; mimeType: string }> | "invalid" {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > LIMITS.imagesPerTurn) return "invalid";
  const out: Array<{ data: string; mimeType: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return "invalid";
    const { data, mimeType } = item as { data?: unknown; mimeType?: unknown };
    if (typeof data !== "string" || typeof mimeType !== "string") return "invalid";
    if (!IMAGE_MIME_ALLOWLIST.has(mimeType) || data.length > LIMITS.imageBase64Bytes || !/^[A-Za-z0-9+/=\s]+$/.test(data)) return "invalid";
    out.push({ data, mimeType });
  }
  return out;
}
