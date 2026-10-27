import { Hono } from "hono";
import type { Correction } from "@fluffdesk/core";
import type { AppEnv } from "../app.js";
import { verifyTokenMatches } from "./webhooks.js";

/**
 * 美容师端。这是唯一能把预约从 pending 改成 confirmed/declined 的地方。
 * 鉴权是过渡方案：一个共享的 GROOMER_API_TOKEN，Bearer 带上。没配 token 时整组路由返回 503，
 * 绝不默认放开。正式方案是 magic link 登录并把人绑到店（README TODO）。
 */
export const groomerRoutes = new Hono<AppEnv>();

const MAX_CORRECTIONS = 5000;
const CORRECTION_KINDS = new Set<Correction["kind"]>(["pet_identification", "quote", "reply"]);

groomerRoutes.use("*", async (c, next) => {
  const token = process.env.GROOMER_API_TOKEN;
  if (!token || token.length < 16) return c.json({ error: "groomer auth not configured" }, 503);
  const provided = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!verifyTokenMatches(token, provided)) {
    c.header("www-authenticate", 'Bearer realm="groomer"');
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

groomerRoutes.get("/:shop/bookings/pending", async (c) => {
  const items = await c.get("rt").bookings.listPending(c.req.param("shop"));
  return c.json({ items });
});

groomerRoutes.post("/:shop/bookings/:id/decide", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (body.status !== "confirmed" && body.status !== "declined") return c.json({ error: "status must be confirmed|declined" }, 400);
  if (typeof body.by !== "string" || !body.by) return c.json({ error: "by required" }, 400);
  try {
    const booking = await c.get("rt").bookings.decide(c.req.param("id"), {
      status: body.status,
      by: body.by,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined,
    });
    // TODO: confirmed 之后写日历、通知客人；declined 之后通知客人并给替代时间
    return c.json({ booking });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 409);
  }
});

/** 修正：识图错了、报价不对、回复不合适。全部进 eval 集。字段逐个取，不展开 body */
groomerRoutes.post("/:shop/corrections", async (c) => {
  const rt = c.get("rt");
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!CORRECTION_KINDS.has(body.kind as Correction["kind"])) return c.json({ error: "kind must be pet_identification|quote|reply" }, 400);
  if (typeof body.conversationId !== "string" || typeof body.by !== "string") return c.json({ error: "conversationId and by required" }, 400);
  const correction: Correction = {
    id: `cor_${Date.now().toString(36)}_${rt.corrections.length}`,
    shopSlug: c.req.param("shop"),
    conversationId: body.conversationId,
    traceId: typeof body.traceId === "string" ? body.traceId : undefined,
    kind: body.kind as Correction["kind"],
    original: body.original ?? null,
    corrected: body.corrected ?? null,
    note: typeof body.note === "string" ? body.note.slice(0, 2000) : undefined,
    by: body.by,
    createdAt: new Date().toISOString(),
  };
  rt.corrections.push(correction);
  if (rt.corrections.length > MAX_CORRECTIONS) rt.corrections.splice(0, rt.corrections.length - MAX_CORRECTIONS);
  return c.json({ correction }, 201);
});

groomerRoutes.get("/:shop/shop", (c) => {
  const shop = c.get("rt").shops.get(c.req.param("shop"));
  return shop ? c.json({ shop }) : c.json({ error: "not found" }, 404);
});
