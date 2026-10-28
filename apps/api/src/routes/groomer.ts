import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  BookingStateError, DecisionInputError, findService, parseDecision, parseShopConfig, transcript,
  type BookingStatus, type Correction,
} from "@fluffdesk/core";
import type { AppEnv } from "../app.js";
import { clientIp } from "./chat.js";
import { verifyTokenMatches } from "./webhooks.js";

/**
 * 美容师端。这是唯一能把预约从 pending 改成 confirmed/declined、唯一能改店铺资料的地方。
 * 鉴权是过渡方案：一个共享的 GROOMER_API_TOKEN，Bearer 带上。没配 token 时整组路由返回 503，
 * 绝不默认放开。正式方案是 magic link 登录并把人绑到店（README TODO）。
 * 路径里的 :shop 现在就校验并绑到每个对象上（预约、会话、资料），免得将来按店发 token 时这里变成越权点。
 * 配置只从 createApp 给的 env 读，不碰全局环境。
 */
export function groomerRoutes(env: Record<string, string | undefined>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const token = env.GROOMER_API_TOKEN;

  routes.use("*", async (c, next) => {
    if (!token || token.length < 16) return c.json({ error: "groomer auth not configured" }, 503);
    const { limits } = c.get("rt");
    const ip = clientIp(c);
    // 美容师端有自己的每 IP 预算，不和公网聊天共用：开一条预约就是十来个请求
    if (!limits.groomerIp.take(ip)) return c.json({ error: "too many requests" }, 429);
    const provided = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!verifyTokenMatches(token, provided)) {
      // 猜令牌单独数：失败次数到了就一直 429，对的令牌不受影响
      if (!limits.groomerAuth.take(ip)) return c.json({ error: "too many requests" }, 429);
      c.header("www-authenticate", 'Bearer realm="groomer"');
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  routes.use("/:shop/*", async (c, next) => {
    const shop = await c.get("rt").shops.get(c.req.param("shop"));
    if (!shop) return c.json({ error: "not found" }, 404);
    c.set("shop", shop);
    await next();
  });

  /**
   * 队列和历史。?status=pending（默认）| decided | all，最多 200 条。
   * ?date=YYYY-MM-DD 是另一种视图：那天已确认的全部预约，给当天安排条用，不限条数（status 只能省略或为 confirmed）
   */
  routes.get("/:shop/bookings", async (c) => {
    const date = c.req.query("date");
    const view = c.req.query("status") ?? (date ? "confirmed" : "pending");
    if (date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
      if (view !== "confirmed") return c.json({ error: "date only lists confirmed bookings" }, 400);
      return c.json({ items: await c.get("rt").bookings.listConfirmedOn(c.req.param("shop"), date) });
    }
    // 普通对象查找会命中 constructor 这类原型键，所以先 hasOwn
    if (!Object.hasOwn(STATUS_VIEWS, view)) return c.json({ error: "status must be pending|decided|all" }, 400);
    const items = await c.get("rt").bookings.listByStatus(c.req.param("shop"), STATUS_VIEWS[view]!, 200);
    return c.json({ items });
  });

  routes.post("/:shop/bookings/:id/decide", async (c) => {
    const body = await c.req.json<unknown>().catch(() => ({}));
    let decision;
    try {
      decision = parseDecision(body);
    } catch (e) {
      if (e instanceof DecisionInputError) return c.json({ error: e.message }, 400);
      throw e;
    }
    const bookings = c.get("rt").bookings;
    const existing = await bookings.get(c.req.param("id"));
    // 预约必须属于路径里的店：别的店的 id 一律当不存在
    if (!existing || existing.shopSlug !== c.req.param("shop")) return c.json({ error: "not found" }, 404);
    try {
      const booking = await bookings.decide(existing.id, decision);
      // TODO: confirmed 之后写日历、通知客人；declined 之后把 alternatives 带给客人
      return c.json({ booking });
    } catch (e) {
      // 只有业务拒绝回 409；数据库驱动的报错走 onError，不把细节吐出去
      if (e instanceof BookingStateError) return c.json({ error: e.message }, 409);
      throw e;
    }
  });

  /** 会话记录：只有文字和图片 id。会话必须属于路径里的店 */
  routes.get("/:shop/conversations/:id", async (c) => {
    const conv = await c.get("rt").conversations.get(c.req.param("id"));
    if (!conv || conv.shopSlug !== c.req.param("shop")) return c.json({ error: "not found" }, 404);
    return c.json({ id: conv.id, channel: conv.channel, locale: conv.locale, entries: transcript(conv), images: [...conv.images.keys()] });
  });

  /** 客人发的图，按 id 取。闲置 24 小时后图片会被清掉，那时回 404 */
  routes.get("/:shop/conversations/:id/images/:imageId", async (c) => {
    const imageId = c.req.param("imageId");
    if (!/^img_\d{1,3}$/.test(imageId)) return c.json({ error: "not found" }, 404);
    const conv = await c.get("rt").conversations.get(c.req.param("id"));
    if (!conv || conv.shopSlug !== c.req.param("shop")) return c.json({ error: "not found" }, 404);
    const img = conv.images.get(imageId);
    if (!img) return c.json({ error: "not found" }, 404);
    return c.body(Buffer.from(img.data, "base64"), 200, {
      "content-type": img.mimeType,
      "content-disposition": "inline",
      // 客人照片不进任何缓存：共享平板上退出登录后不该还能从缓存里翻出来
      "cache-control": "private, no-store",
    });
  });

  /** 拒绝时挑替代时段用：某天某服务的空档，和 agent 的 check_availability 看同一本日历 */
  routes.get("/:shop/availability", async (c) => {
    const date = c.req.query("date") ?? "";
    const serviceId = c.req.query("serviceId") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    const shop = c.get("shop")!;
    const service = findService(shop, serviceId);
    if (!service) return c.json({ error: "unknown service" }, 400);
    const slots = await c.get("rt").calendarFor(shop).freeSlots(date, service.durationMin);
    return c.json({ date, serviceId, durationMin: service.durationMin, slots });
  });

  /** 修正：识图错了、报价不对、回复不合适。全部进 eval 集。字段逐个取，不展开 body */
  routes.post("/:shop/corrections", async (c) => {
    const rt = c.get("rt");
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (!CORRECTION_KINDS.has(body.kind as Correction["kind"])) return c.json({ error: "kind must be pet_identification|quote|reply" }, 400);
    if (typeof body.conversationId !== "string" || typeof body.by !== "string") return c.json({ error: "conversationId and by required" }, 400);
    const correction: Correction = {
      id: `cor_${randomUUID()}`,
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
    await rt.corrections.add(correction);
    return c.json({ correction }, 201);
  });

  routes.get("/:shop/corrections", async (c) => {
    const items = await c.get("rt").corrections.list(c.req.param("shop"));
    return c.json({ items });
  });

  routes.get("/:shop/shop", (c) => c.json({ shop: c.get("shop") }));

  /** 店铺资料整份覆盖。slug 必须和路径一致，内容必须过 core 的 schema；美容师改不出一家新店 */
  routes.put("/:shop/shop", async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (body.slug !== c.req.param("shop")) return c.json({ error: "slug must match the path" }, 400);
    let config;
    try {
      config = parseShopConfig(body);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    const saved = await c.get("rt").shops.save(config);
    if (!saved) return c.json({ error: "not found" }, 404);
    return c.json({ shop: config });
  });

  return routes;
}

const CORRECTION_KINDS = new Set<Correction["kind"]>(["pet_identification", "quote", "reply"]);

const STATUS_VIEWS: Record<string, BookingStatus[] | undefined> = {
  pending: ["pending"],
  decided: ["confirmed", "declined", "cancelled"],
  all: ["pending", "confirmed", "declined", "cancelled"],
};
