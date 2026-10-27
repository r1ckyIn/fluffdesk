import { Hono } from "hono";
import type { AppEnv } from "../app.js";

/**
 * 美容师端。这是唯一能把预约从 pending 改成 confirmed/declined 的地方。
 * TODO: 登录（magic link）、Web Push 订阅、邮件兜底。
 */
export const groomerRoutes = new Hono<AppEnv>();

groomerRoutes.get("/:shop/bookings/pending", async (c) => {
  const items = await c.get("rt").bookings.listPending(c.req.param("shop"));
  return c.json({ items });
});

groomerRoutes.post("/:shop/bookings/:id/decide", async (c) => {
  const body = await c.req.json<{ status: "confirmed" | "declined"; by: string; reason?: string }>();
  if (body.status !== "confirmed" && body.status !== "declined") return c.json({ error: "status must be confirmed|declined" }, 400);
  try {
    const booking = await c.get("rt").bookings.decide(c.req.param("id"), body);
    // TODO: confirmed 之后写日历、通知客人；declined 之后通知客人并给替代时间
    return c.json({ booking });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 409);
  }
});

/** 修正：识图错了、报价不对、回复不合适。全部进 eval 集 */
groomerRoutes.post("/:shop/corrections", async (c) => {
  const rt = c.get("rt");
  const body = await c.req.json<{ conversationId: string; traceId?: string; kind: "pet_identification" | "quote" | "reply"; original: unknown; corrected: unknown; note?: string; by: string }>();
  const correction = { id: `cor_${Date.now().toString(36)}`, shopSlug: c.req.param("shop"), createdAt: new Date().toISOString(), ...body };
  rt.corrections.push(correction);
  return c.json({ correction }, 201);
});

groomerRoutes.get("/:shop/shop", (c) => {
  const shop = c.get("rt").shops.get(c.req.param("shop"));
  return shop ? c.json({ shop }) : c.json({ error: "not found" }, 404);
});
