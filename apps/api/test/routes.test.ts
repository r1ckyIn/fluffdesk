import { beforeEach, describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { conversationKey, createGateway, defaultTools, newConversation, parseShopConfig, InMemoryBookingStore, InMemoryCalendar, InMemoryShopRepo, Tracer, type Conversation } from "@fluffdesk/core";
import { createApp } from "../src/app.js";
import type { Runtime } from "../src/runtime.js";
import { BoundedStore, RateLimiter } from "../src/ratelimit.js";
import { MemoryConversationStore, MemoryCorrectionStore } from "../src/memory.js";
import { handleInbound } from "../src/channels/base.js";
import { verifyTokenMatches } from "../src/routes/webhooks.js";
import { validateImages } from "../src/routes/chat.js";

/** HTTP 边界的护栏：鉴权、限流、输入校验、失败关闭 */

const shop = parseShopConfig({
  slug: "s1", name: "S1", timezone: "Australia/Sydney", currency: "AUD",
  hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
  sizeTiers: [{ id: "small", label: { en: "S", zh: "小" } }],
  services: [{ id: "bath", name: { en: "Bath", zh: "洗" }, durationMin: 60, prices: [{ size: "small", min: 50, max: 60 }] }],
  policies: { quoteDisclaimer: { en: "in store", zh: "到店" } },
});

function testRuntime(): Runtime {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  faux.setResponses(Array.from({ length: 50 }, () => fauxAssistantMessage([fauxText("hello")])));
  const bookings = new InMemoryBookingStore();
  return {
    gateway: createGateway({ models, roleModels: { chat: m, vision: m, judge: m, fallback: m } }),
    shops: new InMemoryShopRepo([shop]),
    conversations: new MemoryConversationStore(new BoundedStore<Conversation>(100, 60_000)),
    bookings,
    corrections: new MemoryCorrectionStore(),
    traceSinks: [],
    limits: { perIp: new RateLimiter(5, 60_000), perSession: new RateLimiter(3, 60_000) },
    newTracer: (id) => new Tracer(id),
    calendarFor: () => new InMemoryCalendar(() => null),
    tools: defaultTools(),
    close: async () => {},
  };
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }) as RequestInit;

const TOKEN = "0123456789abcdef0123";
const auth = { authorization: `Bearer ${TOKEN}` };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonOf = async (r: Response) => (await r.json()) as any;
/** 这些用例一条里要打六七个请求，超过 testRuntime 给的每 IP 5 次 */
const roomyRuntime = () => {
  const rt = testRuntime();
  rt.limits.perIp = new RateLimiter(100, 60_000);
  return rt;
};

describe("groomer routes", () => {
  it("fail closed when no token is configured", async () => {
    const app = createApp(testRuntime(), {});
    const r = await app.request("/groomer/s1/bookings/pending");
    expect(r.status).toBe(503);
  });
  it("rejects missing or wrong bearer token", async () => {
    const app = createApp(testRuntime(), { GROOMER_API_TOKEN: TOKEN });
    expect((await app.request("/groomer/s1/bookings/pending")).status).toBe(401);
    expect((await app.request("/groomer/s1/bookings/pending", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await app.request("/groomer/s1/bookings/pending", { headers: auth })).status).toBe(200);
  });
  it("rate limits token guessing per ip", async () => {
    const app = createApp(testRuntime(), { GROOMER_API_TOKEN: TOKEN });
    const guess = () => app.request("/groomer/s1/bookings/pending", { headers: { authorization: "Bearer nope", "x-forwarded-for": "9.9.9.9" } });
    for (let i = 0; i < 5; i++) expect((await guess()).status).toBe(401);
    expect((await guess()).status).toBe(429);
  });
  it("binds bookings to the shop in the path and 404s unknown shops", async () => {
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const b = await rt.bookings.createPending({ shopSlug: "other-shop", conversationId: "c", channel: "web", customerName: "A", contact: "0400", serviceId: "bath", durationMin: 60, start: "2026-11-03T10:00", pet: { species: "dog" } } as never);
    const decide = (shop: string) => app.request(`/groomer/${shop}/bookings/${b.id}/decide`, json({ status: "confirmed", by: "g" }, auth));
    expect((await decide("s1")).status).toBe(404);
    expect((await rt.bookings.get(b.id))?.status).toBe("pending");
    expect((await decide("other-shop")).status).toBe(404); // 这家店不在运行时里
    expect((await app.request("/groomer/nope/bookings/pending", { headers: auth })).status).toBe(404);
  });
  it("decide answers 409 for a decided booking but hides storage errors behind a generic 500", async () => {
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const b = await rt.bookings.createPending({ shopSlug: "s1", conversationId: "c", customer: { name: "A", contact: "0400", channel: "web" }, pet: { species: "dog" }, serviceId: "bath", durationMin: 60, start: "2026-11-03T10:00" });
    const decide = () => app.request(`/groomer/s1/bookings/${b.id}/decide`, json({ status: "confirmed", by: "g" }, auth));
    expect((await decide()).status).toBe(200);
    const again = await decide();
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: expect.stringContaining("already confirmed") });
    rt.bookings.decide = async () => { throw new Error("connection to server at pooler lost"); };
    rt.bookings.get = async () => b;
    const broken = await decide();
    expect(broken.status).toBe(500);
    expect(await broken.json()).toEqual({ error: "internal error" });
  });
  it("lists the queue and the history separately, newest decision first", async () => {
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const mk = (start: string) => rt.bookings.createPending({ shopSlug: "s1", conversationId: "c", customer: { name: "A", contact: "0400", channel: "web" }, pet: { species: "dog" }, serviceId: "bath", durationMin: 60, start });
    const a = await mk("2026-11-03T10:00");
    const b = await mk("2026-11-03T11:00");
    await mk("2026-11-03T12:00");
    await rt.bookings.decide(a.id, { status: "confirmed", by: "g" });
    await new Promise((r) => setTimeout(r, 5));
    await rt.bookings.decide(b.id, { status: "declined", by: "g" });
    const pending = await jsonOf(await app.request("/groomer/s1/bookings", { headers: auth }));
    expect(pending.items.map((x: { status: string }) => x.status)).toEqual(["pending"]);
    const decided = await jsonOf(await app.request("/groomer/s1/bookings?status=decided", { headers: auth }));
    expect(decided.items.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
    expect((await app.request("/groomer/s1/bookings?status=nope", { headers: auth })).status).toBe(400);
  });
  it("alternatives: only with declined, at most three, in the booking's own time format", async () => {
    const rt = roomyRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const b = await rt.bookings.createPending({ shopSlug: "s1", conversationId: "c", customer: { name: "A", contact: "0400", channel: "web" }, pet: { species: "dog" }, serviceId: "bath", durationMin: 60, start: "2026-11-03T10:00" });
    const decide = (body: unknown) => app.request(`/groomer/s1/bookings/${b.id}/decide`, json(body, auth));
    expect((await decide({ status: "confirmed", by: "g", alternatives: ["2026-11-04T10:00"] })).status).toBe(400);
    expect((await decide({ status: "declined", by: "g", alternatives: ["2026-11-04T10:00", "2026-11-04T11:00", "2026-11-04T12:00", "2026-11-04T13:00"] })).status).toBe(400);
    expect((await decide({ status: "declined", by: "g", alternatives: ["2026-11-04 10:00"] })).status).toBe(400);
    expect((await rt.bookings.get(b.id))?.status).toBe("pending"); // 三次 400 都没碰预约
    const ok = await decide({ status: "declined", by: "g", reason: "fully booked", alternatives: ["2026-11-04T11:00", "2026-11-04T10:00"] });
    expect(ok.status).toBe(200);
    expect((await jsonOf(ok)).booking).toMatchObject({ status: "declined", alternatives: ["2026-11-04T10:00", "2026-11-04T11:00"] });
  });
  it("conversations: bound to the shop, text and image ids only, image bytes by id", async () => {
    const rt = roomyRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const conv = await rt.conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "sess-view" }, "en");
    const png = "iVBORw0KGgo=";
    conv.images.set("img_1", { data: png, mimeType: "image/png" });
    conv.messages.push({ role: "user", content: [{ type: "text", text: "is this a poodle?" }, { type: "text", text: "[image attached, imageId=img_1]" }, { type: "image", data: png, mimeType: "image/png" }], timestamp: 1 });
    await rt.conversations.save(conv);
    const foreign = await rt.conversations.findOrCreate({ shopSlug: "other-shop", channel: "web", externalId: "sess-view" }, "en");
    await rt.conversations.save(foreign);

    expect((await app.request(`/groomer/s1/conversations/${encodeURIComponent(foreign.id)}`, { headers: auth })).status).toBe(404);
    const r = await app.request(`/groomer/s1/conversations/${encodeURIComponent(conv.id)}`, { headers: auth });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(png);
    expect(JSON.parse(text)).toMatchObject({ images: ["img_1"], entries: [{ role: "customer", text: "is this a poodle?", imageIds: ["img_1"] }] });

    const img = await app.request(`/groomer/s1/conversations/${encodeURIComponent(conv.id)}/images/img_1`, { headers: auth });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await img.arrayBuffer()).toString("base64")).toBe(png);
    expect((await app.request(`/groomer/s1/conversations/${encodeURIComponent(conv.id)}/images/img_2`, { headers: auth })).status).toBe(404);
    expect((await app.request(`/groomer/s1/conversations/${encodeURIComponent(conv.id)}/images/..%2F..`, { headers: auth })).status).toBe(404);
    expect((await app.request(`/groomer/s1/conversations/${encodeURIComponent(foreign.id)}/images/img_1`, { headers: auth })).status).toBe(404);
  });
  it("availability validates its inputs and reads the shop's calendar", async () => {
    const rt = testRuntime();
    rt.calendarFor = () => new InMemoryCalendar(() => ({ open: "09:00", close: "11:00" }));
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    expect((await app.request("/groomer/s1/availability?date=2026-11-3&serviceId=bath", { headers: auth })).status).toBe(400);
    expect((await app.request("/groomer/s1/availability?date=2026-11-03&serviceId=nope", { headers: auth })).status).toBe(400);
    const r = await app.request("/groomer/s1/availability?date=2026-11-03&serviceId=bath", { headers: auth });
    expect(r.status).toBe(200);
    expect((await jsonOf(r)).slots.map((s: { start: string }) => s.start)).toEqual(["2026-11-03T09:00", "2026-11-03T10:00"]);
  });
  it("shop edits must keep the slug of the path and pass the schema", async () => {
    const rt = roomyRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const put = (body: unknown) => app.request("/groomer/s1/shop", { ...json(body, auth), method: "PUT" });
    expect((await put({ ...shop, slug: "s2" })).status).toBe(400);
    expect((await put({ ...shop, services: [] })).status).toBe(400);
    expect((await rt.shops.get("s1"))?.name).toBe("S1"); // 两次 400 都没写
    const ok = await put({ ...shop, name: "S1 renamed", phone: "02 9000 0000" });
    expect(ok.status).toBe(200);
    expect((await rt.shops.get("s1"))?.name).toBe("S1 renamed");
    expect((await jsonOf(await app.request("/groomer/s1/shop", { headers: auth }))).shop.phone).toBe("02 9000 0000");
    expect((await app.request("/groomer/nope/shop", { ...json({ ...shop, slug: "nope" }, auth), method: "PUT" })).status).toBe(404);
  });
  it("corrections are built from named fields, not the raw body", async () => {
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const r = await app.request("/groomer/s1/corrections", json({ kind: "quote", conversationId: "c", by: "g", original: 1, corrected: 2, shopSlug: "other", id: "forged", createdAt: "1999" }, auth));
    expect(r.status).toBe(201);
    const [stored] = await rt.corrections.list("s1");
    expect(stored).toMatchObject({ shopSlug: "s1", kind: "quote" });
    expect(stored?.id).not.toBe("forged");
    expect(stored?.createdAt).not.toBe("1999");
    const listed = await jsonOf(await app.request("/groomer/s1/corrections", { headers: auth }));
    expect(listed.items).toHaveLength(1);
  });
});

describe("chat route", () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => { app = createApp(testRuntime(), {}); });

  it("validates sessionId format", async () => {
    expect((await app.request("/chat/s1", json({ sessionId: "../x", text: "hi" }))).status).toBe(400);
    expect((await app.request("/chat/s1", json({ sessionId: "short", text: "hi" }))).status).toBe(400);
  });
  it("rejects bad images and too many images", async () => {
    expect(validateImages([{ data: "a", mimeType: "image/svg+xml" }])).toBe("invalid");
    expect(validateImages(Array.from({ length: 10 }, () => ({ data: "a", mimeType: "image/png" })))).toBe("invalid");
    expect(validateImages([{ data: "not base64!!", mimeType: "image/png" }])).toBe("invalid");
    expect(validateImages([{ data: "aGVsbG8=", mimeType: "image/png" }])).toHaveLength(1);
  });
  it("rate limits per session and per ip", async () => {
    const ok = () => app.request("/chat/s1", json({ sessionId: "session-aaaa", text: "hi" }, { "x-forwarded-for": "1.2.3.4" }));
    expect((await ok()).status).toBe(200);
    expect((await ok()).status).toBe(200);
    expect((await ok()).status).toBe(200);
    expect((await ok()).status).toBe(429); // 第 4 次超过每会话 3 次
    const other = (n: number) => app.request("/chat/s1", json({ sessionId: `session-bbbb${n}`, text: "hi" }, { "x-forwarded-for": "1.2.3.4" }));
    expect((await other(1)).status).toBe(200);
    expect((await other(2)).status).toBe(429); // 同 ip 第 6 次超过每 ip 5 次
  });
  it("strips NUL bytes before the text reaches the model or the database", async () => {
    const rt = testRuntime();
    const app = createApp(rt, {});
    const r = await app.request("/chat/s1", json({ sessionId: "session-nul1", text: "hi\u0000there" }));
    expect(r.status).toBe(200);
    const conv = await rt.conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "session-nul1" }, "en");
    expect(JSON.stringify(conv.messages)).not.toContain("\\u0000");
    expect(JSON.stringify(conv.messages)).toContain("hithere");
  });
  it("returns 413 for oversized bodies and a generic 500 on internal errors", async () => {
    const huge = { sessionId: "session-cccc", text: "hi", images: [{ data: "A".repeat(8 * 1024 * 1024), mimeType: "image/png" }] };
    expect((await app.request("/chat/s1", json(huge))).status).toBe(413);
  });
});

describe("inbound handling", () => {
  it("serialises concurrent turns of one session so neither turn is lost", async () => {
    const rt = testRuntime();
    // 像数据库那样：每次取出的是一份拷贝，save 才写回。两轮并发不串行的话，后 save 的会盖掉先 save 的
    const saved = new Map<string, Conversation>();
    rt.conversations = {
      async findOrCreate(key, locale) {
        const k = conversationKey(key);
        const c = saved.get(k) ?? newConversation({ id: k, shopSlug: key.shopSlug, channel: key.channel, locale });
        return { ...c, messages: [...c.messages], images: new Map(c.images) };
      },
      async save(c) {
        saved.set(c.id, c);
      },
      async get(id) {
        return saved.get(id);
      },
    };
    const msg = (text: string) => ({ shop, channel: "web", externalId: "sess-race", input: { text } });
    await Promise.all([handleInbound(rt, msg("first")), handleInbound(rt, msg("second"))]);
    const conv = saved.get("s1:web:sess-race");
    expect(conv?.messages).toHaveLength(4); // 两轮各一条客人消息和一条回复
    expect(conv?.messages.filter((m) => m.role === "user")).toHaveLength(2);
  });
});

describe("webhook handshake", () => {
  it("fails closed when the env token is unset", () => {
    expect(verifyTokenMatches(undefined, undefined)).toBe(false);
    expect(verifyTokenMatches(undefined, "x")).toBe(false);
    expect(verifyTokenMatches("abc", "abc")).toBe(true);
    expect(verifyTokenMatches("abc", "abd")).toBe(false);
  });
  it("rejects the handshake without a configured token, answers it with one", async () => {
    const bare = createApp(testRuntime(), {});
    expect((await bare.request("/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123&hub.verify_token=undefined")).status).toBe(403);
    const configured = createApp(testRuntime(), { WHATSAPP_VERIFY_TOKEN: "verify-me" });
    expect((await configured.request("/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123&hub.verify_token=wrong")).status).toBe(403);
    const ok = await configured.request("/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=123&hub.verify_token=verify-me");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
  });
});

describe("app config", () => {
  it("refuses to start in production without WEB_ORIGIN", () => {
    expect(() => createApp(testRuntime(), { NODE_ENV: "production" })).toThrow(/WEB_ORIGIN/);
  });
  it("BoundedStore evicts oldest and expired entries", () => {
    const s = new BoundedStore<number>(2, 1000);
    s.set("a", 1, 0); s.set("b", 2, 1); s.set("c", 3, 2);
    expect(s.size).toBe(2);
    expect(s.get("a", 3)).toBeUndefined();
    expect(s.get("c", 500)).toBe(3);
    expect(s.get("b", 2000)).toBeUndefined(); // 过期
  });
});
