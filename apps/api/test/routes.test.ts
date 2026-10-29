import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { conversationKey, createGateway, defaultTools, newConversation, parseShopConfig, InMemoryBookingStore, InMemoryCalendar, InMemoryShopRepo, LIMITS, Tracer, type Conversation } from "@fluffdesk/core";
import { chunkByBytes, chunkText, MEDIA_MAX_BYTES, verifyMetaSignature } from "../src/channels/meta.js";
import { parseWhatsAppPayload } from "../src/channels/whatsapp.js";
import { CANNED } from "../src/channels/inbound.js";
import { parseInstagramPayload } from "../src/channels/instagram.js";
import { createApp } from "../src/app.js";
import { createRuntime, type Runtime } from "../src/runtime.js";
import { BoundedStore, RateLimiter } from "../src/ratelimit.js";
import { BackgroundTasks } from "../src/background.js";
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

function testRuntime(replyText = "hello"): Runtime {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  faux.setResponses(Array.from({ length: 50 }, () => fauxAssistantMessage([fauxText(replyText)])));
  const bookings = new InMemoryBookingStore();
  return {
    gateway: createGateway({ models, roleModels: { chat: m, vision: m, judge: m, fallback: m } }),
    shops: new InMemoryShopRepo([shop]),
    conversations: new MemoryConversationStore(new BoundedStore<Conversation>(100, 60_000)),
    bookings,
    corrections: new MemoryCorrectionStore(),
    traceSinks: [],
    limits: { perIp: new RateLimiter(5, 60_000), perSession: new RateLimiter(3, 60_000), groomerIp: new RateLimiter(100, 60_000), groomerAuth: new RateLimiter(5, 60_000), groomerAuthAll: new RateLimiter(7, 60_000), webhookIp: new RateLimiter(20, 60_000) },
    background: new BackgroundTasks(),
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
/** 可控时钟：每调一次往后走一秒，测排序不用睡 */
const ticking = () => {
  let t = Date.parse("2026-10-28T00:00:00Z");
  return () => new Date((t += 1000)).toISOString();
};

describe("groomer routes", () => {
  it("fail closed when no token is configured", async () => {
    const app = createApp(testRuntime(), {});
    const r = await app.request("/groomer/s1/bookings");
    expect(r.status).toBe(503);
  });
  it("rejects missing or wrong bearer token", async () => {
    const app = createApp(testRuntime(), { GROOMER_API_TOKEN: TOKEN });
    expect((await app.request("/groomer/s1/bookings")).status).toBe(401);
    expect((await app.request("/groomer/s1/bookings", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    expect((await app.request("/groomer/s1/bookings", { headers: auth })).status).toBe(200);
  });
  it("rate limits token guessing per ip without locking out the real token", async () => {
    const app = createApp(testRuntime(), { GROOMER_API_TOKEN: TOKEN });
    const guess = () => app.request("/groomer/s1/bookings", { headers: { authorization: "Bearer nope", "x-forwarded-for": "9.9.9.9" } });
    for (let i = 0; i < 5; i++) expect((await guess()).status).toBe(401);
    expect((await guess()).status).toBe(429);
    expect((await app.request("/groomer/s1/bookings", { headers: { ...auth, "x-forwarded-for": "9.9.9.9" } })).status).toBe(200);
  });
  it("token guessing is also capped across all ips, so spoofing x-forwarded-for does not buy more tries", async () => {
    const app = createApp(testRuntime(), { GROOMER_API_TOKEN: TOKEN }); // 全站失败预算 7
    const guess = (i: number) => app.request("/groomer/s1/bookings", { headers: { authorization: "Bearer nope", "x-forwarded-for": `10.0.0.${i}` } });
    for (let i = 1; i <= 7; i++) expect((await guess(i)).status).toBe(401);
    expect((await guess(8)).status).toBe(429);
    expect((await app.request("/groomer/s1/bookings", { headers: { ...auth, "x-forwarded-for": "10.0.0.9" } })).status).toBe(200);
  });
  it("groomer traffic has its own per-ip budget, separate from the public chat limit", async () => {
    const app = createApp(testRuntime(), { GROOMER_API_TOKEN: TOKEN }); // 聊天的每 IP 预算是 5
    for (let i = 0; i < 8; i++) expect((await app.request("/groomer/s1/bookings", { headers: auth })).status).toBe(200);
  });
  it("binds bookings to the shop in the path and 404s unknown shops", async () => {
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const b = await rt.bookings.createPending({ shopSlug: "other-shop", conversationId: "c", channel: "web", customerName: "A", contact: "0400", serviceId: "bath", durationMin: 60, start: "2026-11-03T10:00", pet: { species: "dog" } } as never);
    const decide = (shop: string) => app.request(`/groomer/${shop}/bookings/${b.id}/decide`, json({ status: "confirmed", by: "g" }, auth));
    expect((await decide("s1")).status).toBe(404);
    expect((await rt.bookings.get(b.id))?.status).toBe("pending");
    expect((await decide("other-shop")).status).toBe(404); // 这家店不在运行时里
    expect((await app.request("/groomer/nope/bookings", { headers: auth })).status).toBe(404);
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
    rt.bookings = new InMemoryBookingStore(undefined, ticking());
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const mk = (start: string) => rt.bookings.createPending({ shopSlug: "s1", conversationId: "c", customer: { name: "A", contact: "0400", channel: "web" }, pet: { species: "dog" }, serviceId: "bath", durationMin: 60, start });
    const a = await mk("2026-11-03T10:00");
    const b = await mk("2026-11-03T11:00");
    await mk("2026-11-03T12:00");
    await rt.bookings.decide(a.id, { status: "confirmed", by: "g" });
    await rt.bookings.decide(b.id, { status: "declined", by: "g" });
    const pending = await jsonOf(await app.request("/groomer/s1/bookings", { headers: auth }));
    expect(pending.items.map((x: { status: string }) => x.status)).toEqual(["pending"]);
    const decided = await jsonOf(await app.request("/groomer/s1/bookings?status=decided", { headers: auth }));
    expect(decided.items.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
    expect((await app.request("/groomer/s1/bookings?status=nope", { headers: auth })).status).toBe(400);
    expect((await app.request("/groomer/s1/bookings?status=constructor", { headers: auth })).status).toBe(400); // 原型链上的键不是视图
  });
  it("?date= lists every confirmed booking of that day, nothing else", async () => {
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const mk = (start: string) => rt.bookings.createPending({ shopSlug: "s1", conversationId: `c-${start}`, customer: { name: "A", contact: "0400", channel: "web" }, pet: { species: "dog" }, serviceId: "bath", durationMin: 60, start });
    const late = await mk("2026-11-03T14:00");
    const early = await mk("2026-11-03T09:00");
    const otherDay = await mk("2026-11-04T09:00");
    await mk("2026-11-03T11:00"); // 还是 pending，不算
    for (const x of [late, early, otherDay]) await rt.bookings.decide(x.id, { status: "confirmed", by: "g" });
    const day = await jsonOf(await app.request("/groomer/s1/bookings?date=2026-11-03", { headers: auth }));
    expect(day.items.map((x: { id: string }) => x.id)).toEqual([early.id, late.id]);
    expect((await app.request("/groomer/s1/bookings?date=2026-11-3", { headers: auth })).status).toBe(400);
    expect((await app.request("/groomer/s1/bookings?date=2026-11-03&status=pending", { headers: auth })).status).toBe(400);
  });
  it("alternatives: only with declined, at most three, in the booking's own time format", async () => {
    const rt = testRuntime();
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
    const rt = testRuntime();
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
    expect(img.headers.get("cache-control")).toMatch(/no-store/); // 客人照片不进缓存
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
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const put = (body: unknown) => app.request("/groomer/s1/shop", { ...json(body, auth), method: "PUT" });
    expect((await put({ ...shop, slug: "s2" })).status).toBe(400);
    expect((await put({ ...shop, services: [] })).status).toBe(400);
    expect((await put({ ...shop, services: [...shop.services, { ...shop.services[0]! }] })).status).toBe(400); // 重复 id 在写边界被拒
    expect((await rt.shops.get("s1"))?.name).toBe("S1"); // 两次 400 都没写
    const ok = await put({ ...shop, name: "S1 renamed", phone: "02 9000 0000" });
    expect(ok.status).toBe(200);
    expect((await rt.shops.get("s1"))?.name).toBe("S1 renamed");
    expect((await jsonOf(await app.request("/groomer/s1/shop", { headers: auth }))).shop.phone).toBe("02 9000 0000");
    expect((await app.request("/groomer/nope/shop", { ...json({ ...shop, slug: "nope" }, auth), method: "PUT" })).status).toBe(404);
  });
  it("refuses to bind a channel account id that another shop already uses", async () => {
    const rt = testRuntime();
    const rival = parseShopConfig({ ...shop, slug: "rival", channels: { whatsapp: { phoneNumberId: "pn-taken" }, instagram: { accountId: "ig-taken" } } });
    rt.shops = new InMemoryShopRepo([shop, rival]);
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const put = (body: unknown) => app.request("/groomer/s1/shop", { ...json(body, auth), method: "PUT" });
    const conflict = await put({ ...shop, channels: { whatsapp: { phoneNumberId: "pn-taken" } } });
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain("rival"); // 不把占着这个号的店是谁说出去
    expect((await put({ ...shop, channels: { instagram: { accountId: "ig-taken" } } })).status).toBe(409);
    expect((await rt.shops.get("s1"))?.channels).toBeUndefined(); // 两次都没写
    expect((await put({ ...shop, channels: { whatsapp: { phoneNumberId: "pn-free" } } })).status).toBe(200);
    // 自己已经绑着的 id 再提交一次不算冲突
    expect((await put({ ...shop, channels: { whatsapp: { phoneNumberId: "pn-free" } }, name: "S1 again" })).status).toBe(200);
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
    expect((await app.request("/groomer/s1/corrections", json({ kind: "reply", conversationId: "  ", by: "g" }, auth))).status).toBe(400);
    expect((await app.request("/groomer/s1/corrections", json({ kind: "reply", conversationId: "c", by: "  " }, auth))).status).toBe(400);
    const padded = await jsonOf(await app.request("/groomer/s1/corrections", json({ kind: "reply", conversationId: " c3 ", by: ` ${"g".repeat(100)} ` }, auth)));
    expect(padded.correction.conversationId).toBe("c3"); // 存进去的是去掉空白的，不然按会话查不到
    expect(padded.correction.by.length).toBeLessThan(100);
    expect(padded.correction.by.startsWith("g")).toBe(true);
    await app.request("/groomer/s1/corrections", json({ kind: "reply", conversationId: "c2", by: "g" }, auth));
    const mine = await jsonOf(await app.request("/groomer/s1/corrections?conversationId=c", { headers: auth }));
    expect(mine.items.map((x: { conversationId: string }) => x.conversationId)).toEqual(["c"]);
    const listed = await jsonOf(await app.request("/groomer/s1/corrections", { headers: auth }));
    expect(listed.items).toHaveLength(3);
    expect((await jsonOf(await app.request("/groomer/s1/corrections?conversationId=", { headers: auth }))).items).toEqual([]); // 给了参数就按它过滤，空串不等于不过滤
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

/**
 * WhatsApp webhook：验签失败关闭、消息去重、按 phone_number_id 找店、图片经 Graph 拉取、不支持的类型回固定话术。
 * 出网全部走假 fetch：Graph 的发消息、媒体元数据、媒体下载各记一笔，断言用
 */
describe("whatsapp webhook", () => {
  const SECRET = "wa-app-secret";
  const WA_TOKEN = "wa-access-token";
  const GRAPH = "https://graph.test/v21.0";
  const MEDIA_URL = "https://lookaside.test/whatsapp_business/attachments/?mid=m1";
  const waShop = parseShopConfig({ ...shop, slug: "wa", channels: { whatsapp: { phoneNumberId: "pn-1" } } });
  const waEnv = { META_APP_SECRET: SECRET, WHATSAPP_ACCESS_TOKEN: WA_TOKEN };

  interface Call { method: string; url: string; headers: Record<string, string>; body?: string }

  /** 假的出网：记下每次调用；媒体元数据和字节可按测试改 */
  function fakeGraph(opts: { mediaMeta?: Record<string, unknown>; mediaBytes?: Uint8Array; mediaStatus?: number } = {}) {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      calls.push({ method: init?.method ?? "GET", url, headers, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/messages")) return Response.json({ messages: [{ id: "wamid.out" }] });
      if (url === MEDIA_URL) return new Response(opts.mediaBytes ?? new Uint8Array([1, 2, 3]), { status: opts.mediaStatus ?? 200, headers: { "content-type": "image/jpeg" } });
      if (url.startsWith(`${GRAPH}/`)) return Response.json(opts.mediaMeta ?? { url: MEDIA_URL, mime_type: "image/jpeg", file_size: 3, id: "media-1" });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl, sends: () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/messages")) };
  }

  function waApp(env: Record<string, string | undefined> = waEnv, graph = fakeGraph(), lookup = async () => ["93.184.216.34"]) {
    const rt = testRuntime();
    rt.shops = new InMemoryShopRepo([shop, waShop]);
    const app = createApp(rt, env, { fetch: graph.fetchImpl, graphBase: GRAPH, lookup });
    const drain = () => rt.background.drain();
    return { rt, app, graph, drain, pending: () => rt.background.size };
  }

  const message = (m: Record<string, unknown>, phoneNumberId = "pn-1") => ({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "61400000000", phone_number_id: phoneNumberId }, contacts: [{ profile: { name: "Sam" }, wa_id: "61411111111" }], messages: [{ from: "61411111111", id: "wamid.1", timestamp: "1700000000", ...m }] } }] }],
  });
  const text = (body: string, id = "wamid.1") => message({ id, type: "text", text: { body } });
  const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const signed = (payload: unknown, secret = SECRET): RequestInit => {
    const raw = JSON.stringify(payload);
    return { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw, secret) }, body: raw };
  };
  const convOf = (rt: Runtime, from = "61411111111") => rt.conversations.get(`wa:whatsapp:${from}`);

  it("verifyMetaSignature fails closed", () => {
    expect(verifyMetaSignature(undefined, "{}", sign("{}"))).toBe(false);
    expect(verifyMetaSignature(SECRET, "{}", undefined)).toBe(false);
    expect(verifyMetaSignature(SECRET, "{}", "sha1=abc")).toBe(false);
    expect(verifyMetaSignature(SECRET, "{}", sign("{}", "other"))).toBe(false);
    expect(verifyMetaSignature(SECRET, "{}", sign("{} "))).toBe(false); // 原始字节不同就不同
    expect(verifyMetaSignature(SECRET, "{}", sign("{}"))).toBe(true);
  });
  it("returns 503 and processes nothing unless both the app secret and the access token are configured", async () => {
    for (const env of [{}, { META_APP_SECRET: SECRET }, { WHATSAPP_ACCESS_TOKEN: WA_TOKEN }]) {
      const { app, pending } = waApp(env);
      expect((await app.request("/webhooks/whatsapp", signed(text("hi")))).status).toBe(503);
      expect(pending()).toBe(0);
    }
  });
  it("rejects a missing or wrong signature before touching the payload", async () => {
    const { app, pending, graph } = waApp();
    const raw = JSON.stringify(text("hi"));
    expect((await app.request("/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: raw })).status).toBe(401);
    expect((await app.request("/webhooks/whatsapp", signed(text("hi"), "wrong-secret"))).status).toBe(401);
    // 签名对的是另一个请求体
    expect((await app.request("/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": sign(raw) }, body: raw + " " })).status).toBe(401);
    expect(pending()).toBe(0);
    expect(graph.calls).toHaveLength(0);
  });
  it("returns 400 for a signed body that is not json", async () => {
    const { app } = waApp();
    const raw = "{not json";
    expect((await app.request("/webhooks/whatsapp", { method: "POST", headers: { "x-hub-signature-256": sign(raw) }, body: raw })).status).toBe(400);
  });
  it("answers a text message through the agent and sends the reply back via Graph", async () => {
    const { app, rt, graph, drain } = waApp();
    const r = await app.request("/webhooks/whatsapp", signed(text("Hi, how much for a bath?")));
    expect(r.status).toBe(200);
    await drain();
    const conv = await convOf(rt);
    expect(conv?.shopSlug).toBe("wa");
    expect(conv?.channel).toBe("whatsapp");
    expect(JSON.stringify(conv?.messages)).toContain("how much for a bath");
    const sends = graph.sends();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.url).toBe(`${GRAPH}/pn-1/messages`);
    expect(sends[0]!.headers.authorization).toBe(`Bearer ${WA_TOKEN}`);
    expect(JSON.parse(sends[0]!.body!)).toMatchObject({ messaging_product: "whatsapp", to: "61411111111", type: "text", text: { body: "hello" } });
  });
  it("processes a redelivered message id only once", async () => {
    const { app, rt, graph, drain } = waApp();
    await app.request("/webhooks/whatsapp", signed(text("first")));
    await app.request("/webhooks/whatsapp", signed(text("first")));
    await app.request("/webhooks/whatsapp", signed(text("second", "wamid.2")));
    await drain();
    expect((await convOf(rt))?.messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(graph.sends()).toHaveLength(2);
  });
  it("drops messages for a phone_number_id no shop is bound to", async () => {
    const { app, rt, graph, drain } = waApp();
    await app.request("/webhooks/whatsapp", signed(message({ type: "text", text: { body: "hi" } }, "pn-unknown")));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(await rt.conversations.get("s1:whatsapp:61411111111")).toBeUndefined();
    expect(graph.calls).toHaveLength(0);
  });
  it("ignores delivery statuses and payloads of other objects", async () => {
    const { app, rt, graph, drain } = waApp();
    const statuses = { object: "whatsapp_business_account", entry: [{ id: "waba-1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "pn-1" }, statuses: [{ id: "wamid.1", status: "delivered", recipient_id: "61411111111" }] } }] }] };
    expect((await app.request("/webhooks/whatsapp", signed(statuses))).status).toBe(200);
    expect((await app.request("/webhooks/whatsapp", signed({ object: "page", entry: [] }))).status).toBe(200);
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(graph.calls).toHaveLength(0);
  });
  it("fetches an image through Graph with the bearer token and hands it to the agent", async () => {
    const { app, rt, graph, drain } = waApp();
    await app.request("/webhooks/whatsapp", signed(message({ type: "image", image: { id: "media-1", mime_type: "image/jpeg", sha256: "x" } })));
    await drain();
    const meta = graph.calls.find((c) => c.url === `${GRAPH}/media-1`);
    const bytes = graph.calls.find((c) => c.url === MEDIA_URL);
    expect(meta?.headers.authorization).toBe(`Bearer ${WA_TOKEN}`);
    expect(bytes?.headers.authorization).toBe(`Bearer ${WA_TOKEN}`);
    const conv = await convOf(rt);
    expect(conv?.images.size).toBe(1);
    expect([...conv!.images.values()][0]).toEqual({ data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "image/jpeg" });
    expect(graph.sends()).toHaveLength(1);
  });
  it.each([
    ["wrong type", { url: MEDIA_URL, mime_type: "image/gif", file_size: 3 }],
    ["declared too large", { url: MEDIA_URL, mime_type: "image/jpeg", file_size: MEDIA_MAX_BYTES + 1 }],
    ["no url", { mime_type: "image/jpeg", file_size: 3 }],
  ])("replies with the canned text instead of calling the model when the image is %s", async (_label, mediaMeta) => {
    const { app, rt, graph, drain } = waApp(waEnv, fakeGraph({ mediaMeta }));
    await app.request("/webhooks/whatsapp", signed(message({ type: "image", image: { id: "media-1" } })));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(graph.calls.some((c) => c.url === MEDIA_URL)).toBe(false);
    expect(JSON.parse(graph.sends()[0]!.body!).text.body).toBe(CANNED.mediaFailed);
  });
  it("rejects an image whose actual bytes exceed the cap even if the metadata said otherwise", async () => {
    const { app, rt, graph, drain } = waApp(waEnv, fakeGraph({ mediaBytes: new Uint8Array(MEDIA_MAX_BYTES + 1) }));
    await app.request("/webhooks/whatsapp", signed(message({ type: "image", image: { id: "media-1" } })));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(JSON.parse(graph.sends()[0]!.body!).text.body).toBe(CANNED.mediaFailed);
  });
  it("refuses to download media from a url that resolves to a private address", async () => {
    const { app, rt, graph, drain } = waApp(waEnv, fakeGraph(), async () => ["10.0.0.9"]);
    await app.request("/webhooks/whatsapp", signed(message({ type: "image", image: { id: "media-1" } })));
    await drain();
    expect(graph.calls.some((c) => c.url === MEDIA_URL)).toBe(false);
    expect(await convOf(rt)).toBeUndefined();
    expect(JSON.parse(graph.sends()[0]!.body!).text.body).toBe(CANNED.mediaFailed);
  });
  it("still runs the agent on the caption when the image fails", async () => {
    const { app, rt, graph, drain } = waApp(waEnv, fakeGraph({ mediaStatus: 500 }));
    await app.request("/webhooks/whatsapp", signed(message({ type: "image", image: { id: "media-1", caption: "this is Max, 8kg" } })));
    await drain();
    const conv = await convOf(rt);
    expect(conv?.images.size).toBe(0);
    expect(JSON.stringify(conv?.messages)).toContain("this is Max");
    expect(JSON.parse(graph.sends()[0]!.body!).text.body).toBe("hello");
  });
  it("answers unsupported message types with the canned text and never calls the model", async () => {
    const { app, rt, graph, drain } = waApp();
    await app.request("/webhooks/whatsapp", signed(message({ type: "audio", audio: { id: "a1" } })));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(JSON.parse(graph.sends()[0]!.body!).text.body).toBe(CANNED.unsupported);
  });
  it("drops messages beyond the per-session budget without replying", async () => {
    const { app, rt, graph, drain } = waApp();
    rt.limits.perSession = new RateLimiter(3, 60_000);
    for (let i = 0; i < 5; i++) await app.request("/webhooks/whatsapp", signed(text(`m${i}`, `wamid.${i}`)));
    await drain();
    expect(graph.sends()).toHaveLength(3); // 预算 3 条：之后的既不跑模型也不回话
  });
  it("rate-limits the webhook per client ip before reading the body", async () => {
    const { app, rt } = waApp();
    rt.limits.webhookIp = new RateLimiter(2, 60_000);
    const unsigned = { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify(text("hi")) } as RequestInit;
    expect((await app.request("/webhooks/whatsapp", unsigned)).status).toBe(401);
    expect((await app.request("/webhooks/whatsapp", unsigned)).status).toBe(401);
    expect((await app.request("/webhooks/whatsapp", unsigned)).status).toBe(429);
    // 另一个 IP 不受影响
    expect((await app.request("/webhooks/whatsapp", { ...unsigned, headers: { ...(unsigned.headers as Record<string, string>), "x-forwarded-for": "203.0.113.10" } })).status).toBe(401);
  });
  it("rt.close() waits for background turns so a deploy does not lose a message after the 200", async () => {
    const graph = fakeGraph();
    const slowSend = graph.fetchImpl;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/messages")) await new Promise((r) => setTimeout(r, 30));
      return slowSend(url, init);
    }) as unknown as typeof fetch;
    // 用真的 createRuntime（内存模式）拿它的 close 接线，只换掉网关和店铺
    const real = createRuntime({});
    const faux = testRuntime();
    const rt: Runtime = { ...real, gateway: faux.gateway, shops: new InMemoryShopRepo([shop, waShop]), conversations: faux.conversations, traceSinks: [], newTracer: faux.newTracer };
    const app = createApp(rt, waEnv, { fetch: fetchImpl, graphBase: GRAPH, lookup: async () => ["93.184.216.34"] });
    expect((await app.request("/webhooks/whatsapp", signed(text("hi")))).status).toBe(200);
    expect(rt.background.size).toBe(1);
    await rt.close();
    expect(graph.sends()).toHaveLength(1);
    expect(rt.background.size).toBe(0);
  });
  it("tells the customer and forgets the message id when processing fails, so a redelivery can succeed", async () => {
    const { app, rt, graph, drain } = waApp();
    let fail = true;
    // 只换 list 这一个方法，原型上的 get/save 留着
    const list = rt.shops.list.bind(rt.shops);
    rt.shops.list = async () => { if (fail) throw new Error("neon hiccup"); return list(); };
    await app.request("/webhooks/whatsapp", signed(text("hi")));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(JSON.parse(graph.sends()[0]!.body!).text.body).toBe(CANNED.failed);
    fail = false;
    await app.request("/webhooks/whatsapp", signed(text("hi")));
    await drain();
    expect((await convOf(rt))?.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(JSON.parse(graph.sends()[1]!.body!).text.body).toBe("hello");
  });
  it("keeps the message id when the failure happens after the turn was saved, so a replay does not re-run the model", async () => {
    const graph = fakeGraph();
    let sends = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      // 第一次发回复时 Graph 挂了，后面都正常
      if (url.endsWith("/messages") && ++sends === 1) return new Response("down", { status: 500 });
      return graph.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    const { app, rt, drain } = waApp(waEnv, { ...graph, fetchImpl });
    await app.request("/webhooks/whatsapp", signed(text("hi")));
    await drain();
    expect((await convOf(rt))?.messages.filter((m) => m.role === "user")).toHaveLength(1); // 轮次已经存了
    expect(JSON.parse(graph.sends().at(-1)!.body!).text.body).toBe(CANNED.failed); // 还是告诉了客人
    await app.request("/webhooks/whatsapp", signed(text("hi")));
    await drain();
    expect((await convOf(rt))?.messages.filter((m) => m.role === "user")).toHaveLength(1); // 重放不再跑模型
  });
  it("strips NUL bytes and caps the text before it reaches the agent", async () => {
    const { app, rt, drain } = waApp();
    await app.request("/webhooks/whatsapp", signed(text("hi\u0000there" + "x".repeat(LIMITS.textChars + 100))));
    await drain();
    const conv = await convOf(rt);
    const dump = JSON.stringify(conv?.messages);
    expect(dump).not.toContain("\\u0000");
    expect(dump).toContain("hithere");
    expect(dump.length).toBeLessThan(LIMITS.textChars + 500);
  });
  it("parseWhatsAppPayload drops malformed entries and keeps the well-formed ones", () => {
    const p = message({ type: "text", text: { body: "ok" } });
    const value = (p.entry[0]!.changes[0]!.value as unknown as { messages: unknown[] });
    value.messages.push({ from: "not-a-number", id: "wamid.x", type: "text", text: { body: "bad" } }, { from: "61411111111", id: "wamid.y", type: "text" }, null, { from: "61411111111", id: "wamid.z", type: "image", image: {} });
    const events = parseWhatsAppPayload(p);
    expect(events.map((e) => e.messageId)).toEqual(["wamid.1"]);
    expect(parseWhatsAppPayload(null)).toEqual([]);
    expect(parseWhatsAppPayload({ object: "whatsapp_business_account", entry: [null, { changes: [null, { field: "other", value: {} }] }] })).toEqual([]);
  });
  it("chunkText splits long replies at line breaks and keeps short ones whole", () => {
    expect(chunkText("short")).toEqual(["short"]);
    expect(chunkText("")).toEqual([""]);
    const long = Array.from({ length: 10 }, (_, i) => `line ${i} ${"y".repeat(600)}`).join("\n");
    const parts = chunkText(long, 4000);
    expect(parts.join("\n")).toBe(long);
    expect(parts.every((p) => p.length <= 4000)).toBe(true);
    expect(parts.length).toBeGreaterThan(1);
    expect(chunkText("x".repeat(9000), 4000).map((p) => p.length)).toEqual([4000, 4000, 1000]);
  });
  it("chunkText never splits a surrogate pair", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const s = "x".repeat(3999) + "🐶" + "y".repeat(10);
    const parts = chunkText(s, 4000);
    expect(parts.join("")).toBe(s);
    for (const p of parts) expect(p).not.toMatch(lone);
    // 退格不能退到 0：max=1 且开头就是代理对时仍要前进（否则死循环）
    const tiny = chunkText("🐶ab", 1);
    expect(tiny.join("")).toBe("🐶ab");
    expect(tiny.every((p) => p.length > 0)).toBe(true);
  });
});

/**
 * Instagram webhook：和 WhatsApp 共用验签、限流、去重、找店、兜底这条流水线，这里只测 Instagram 自己的部分：
 * payload 形状（messaging[] 和 changes[]）、echo / 已删 / 回执忽略、附件直链取图（不带令牌）、发送格式、按字节拆块
 */
describe("instagram webhook", () => {
  const SECRET = "ig-app-secret";
  const IG_TOKEN = "ig-access-token";
  const IG_GRAPH = "https://graph.instagram.test/v21.0";
  const CDN_URL = "https://lookaside.test/ig_messaging_cdn/?asset_id=1";
  const igShop = parseShopConfig({ ...shop, slug: "ig", channels: { instagram: { accountId: "17841400000000001" } } });
  const igEnv = { META_APP_SECRET: SECRET, INSTAGRAM_ACCESS_TOKEN: IG_TOKEN };
  const IGSID = "1234567890123456";

  interface Call { method: string; url: string; headers: Record<string, string>; body?: string }
  function fakeGraph(opts: { cdnStatus?: number; cdnType?: string; cdnBytes?: Uint8Array } = {}) {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      calls.push({ method: init?.method ?? "GET", url, headers, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/messages")) return Response.json({ recipient_id: IGSID, message_id: "mid.out" });
      if (url.startsWith(CDN_URL)) return new Response(opts.cdnBytes ?? new Uint8Array([7, 8, 9]), { status: opts.cdnStatus ?? 200, headers: { "content-type": opts.cdnType ?? "image/jpeg" } });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl, sends: () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/messages")) };
  }
  function igApp(env: Record<string, string | undefined> = igEnv, graph = fakeGraph(), opts: { lookup?: () => Promise<string[]>; replyText?: string } = {}) {
    const rt = testRuntime(opts.replyText);
    rt.shops = new InMemoryShopRepo([shop, igShop]);
    const app = createApp(rt, env, { fetch: graph.fetchImpl, instagramGraphBase: IG_GRAPH, lookup: opts.lookup ?? (async () => ["93.184.216.34"]) });
    return { rt, app, graph, drain: () => rt.background.drain() };
  }
  const event = (message: Record<string, unknown>, extra: Record<string, unknown> = {}, accountId = "17841400000000001") => ({
    object: "instagram",
    entry: [{ id: accountId, time: 1700000000000, messaging: [{ sender: { id: IGSID }, recipient: { id: accountId }, timestamp: 1700000000000, ...(Object.keys(message).length ? { message } : {}), ...extra }] }],
  });
  const text = (t: string, mid = "mid.1") => event({ mid, text: t });
  const sign = (raw: string) => `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  const signed = (payload: unknown): RequestInit => {
    const raw = JSON.stringify(payload);
    return { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) }, body: raw };
  };
  const convOf = (rt: Runtime) => rt.conversations.get(`ig:instagram:${IGSID}`);

  it("returns 503 unless the app secret and the instagram token are configured, 401 on a bad signature", async () => {
    for (const env of [{}, { META_APP_SECRET: SECRET }, { INSTAGRAM_ACCESS_TOKEN: IG_TOKEN }]) {
      expect((await igApp(env).app.request("/webhooks/instagram", signed(text("hi")))).status).toBe(503);
    }
    const { app, rt } = igApp();
    expect((await app.request("/webhooks/instagram", { method: "POST", body: JSON.stringify(text("hi")) })).status).toBe(401);
    expect(rt.background.size).toBe(0);
    // WhatsApp 的 token 配了不等于 Instagram 配了
    expect((await igApp({ META_APP_SECRET: SECRET, WHATSAPP_ACCESS_TOKEN: "x" }).app.request("/webhooks/instagram", signed(text("hi")))).status).toBe(503);
  });
  it("answers a text message through the agent and sends the reply to the IGSID via the instagram graph", async () => {
    const { app, rt, graph, drain } = igApp();
    expect((await app.request("/webhooks/instagram", signed(text("Hi, how much for a bath?")))).status).toBe(200);
    await drain();
    const conv = await convOf(rt);
    expect(conv?.shopSlug).toBe("ig");
    expect(conv?.channel).toBe("instagram");
    expect(JSON.stringify(conv?.messages)).toContain("how much for a bath");
    const sends = graph.sends();
    expect(sends).toHaveLength(1);
    // /me/messages 在 Instagram Login 和 Unified Login 两条路线下都成立，不用猜该填 IG 账号 id 还是 page id
    expect(sends[0]!.url).toBe(`${IG_GRAPH}/me/messages`);
    expect(sends[0]!.headers.authorization).toBe(`Bearer ${IG_TOKEN}`);
    expect(JSON.parse(sends[0]!.body!)).toEqual({ recipient: { id: IGSID }, message: { text: "hello" } });
  });
  it("INSTAGRAM_GRAPH_BASE must be an absolute https url, so a bare host from a config typo fails at startup instead of on every reply", () => {
    expect(() => createApp(testRuntime(), { ...igEnv, INSTAGRAM_GRAPH_BASE: "graph.facebook.com" })).toThrow(/INSTAGRAM_GRAPH_BASE/);
    expect(() => createApp(testRuntime(), { ...igEnv, INSTAGRAM_GRAPH_BASE: "http://graph.facebook.com/v21.0" })).toThrow(/INSTAGRAM_GRAPH_BASE/);
    expect(() => createApp(testRuntime(), { ...igEnv, INSTAGRAM_GRAPH_BASE: "https://graph.facebook.com/v21.0" })).not.toThrow();
    expect(() => createApp(testRuntime(), { ...igEnv, INSTAGRAM_GRAPH_BASE: "https://graph.facebook.com/v21.0/" })).not.toThrow();
  });
  it("splits a long reply into several sends of at most 1000 utf-8 bytes each", async () => {
    const long = "报价区间以到店评估为准。".repeat(120); // 约 4300 字节
    const { app, graph, drain } = igApp(igEnv, fakeGraph(), { replyText: long });
    await app.request("/webhooks/instagram", signed(text("hi")));
    await drain();
    const bodies = graph.sends().map((s) => JSON.parse(s.body!).message.text as string);
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.join("")).toBe(long);
    for (const b of bodies) expect(Buffer.byteLength(b, "utf8")).toBeLessThanOrEqual(1000);
  });
  it("refuses to download an attachment whose url resolves to a private address", async () => {
    const { app, rt, graph, drain } = igApp(igEnv, fakeGraph(), { lookup: async () => ["169.254.169.254"] });
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.ssrf", attachments: [{ type: "image", payload: { url: "https://lookaside.test/ig_messaging_cdn/?asset_id=1" }, }] })));
    await drain();
    expect(graph.calls.some((c) => c.method === "GET")).toBe(false);
    expect(await convOf(rt)).toBeUndefined();
    expect(JSON.parse(graph.sends()[0]!.body!).message.text).toBe(CANNED.mediaFailed);
  });
  it("ignores quick reactions, story mentions and shares instead of scolding the customer", async () => {
    const { app, rt, graph, drain } = igApp();
    for (const [i, type] of ["like_heart", "story_mention", "share", "ig_reel"].entries()) {
      await app.request("/webhooks/instagram", signed(event({ mid: `mid.q${i}`, attachments: [{ type, payload: { url: "https://lookaside.test/x" } }] })));
    }
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(graph.calls).toHaveLength(0);
  });
  it("a message that arrived before the shop was bound can be replayed once the binding exists", async () => {
    const { app, rt, graph, drain } = igApp();
    rt.shops = new InMemoryShopRepo([shop]); // 还没绑
    await app.request("/webhooks/instagram", signed(text("early bird", "mid.early")));
    await drain();
    expect(graph.calls).toHaveLength(0);
    rt.shops = new InMemoryShopRepo([shop, igShop]); // 绑上了，Meta 重投或人工重放
    await app.request("/webhooks/instagram", signed(text("early bird", "mid.early")));
    await drain();
    expect(JSON.stringify((await convOf(rt))?.messages)).toContain("early bird");
    expect(graph.sends()).toHaveLength(1);
  });
  it("ignores a message whose sender is the shop account itself even without the is_echo flag", async () => {
    const { app, rt, graph, drain } = igApp();
    const self = { object: "instagram", entry: [{ id: "17841400000000001", messaging: [{ sender: { id: "17841400000000001" }, recipient: { id: IGSID }, message: { mid: "mid.self", text: "hello" } }] }] };
    await app.request("/webhooks/instagram", signed(self));
    await drain();
    expect(await rt.conversations.get("ig:instagram:17841400000000001")).toBeUndefined();
    expect(graph.calls).toHaveLength(0);
  });
  it("gives each product its own per-ip webhook budget so one product's burst cannot starve the other", async () => {
    const { app, rt } = igApp({ ...igEnv, WHATSAPP_ACCESS_TOKEN: "wa" });
    rt.limits.webhookIp = new RateLimiter(2, 60_000);
    const unsigned = { method: "POST", headers: { "x-forwarded-for": "203.0.113.77" }, body: "{}" } as RequestInit;
    expect((await app.request("/webhooks/instagram", unsigned)).status).toBe(401);
    expect((await app.request("/webhooks/instagram", unsigned)).status).toBe(401);
    expect((await app.request("/webhooks/instagram", unsigned)).status).toBe(429);
    expect((await app.request("/webhooks/whatsapp", unsigned)).status).toBe(401);
  });
  it("also accepts the changes[].value shape and drops events for an account no shop is bound to", async () => {
    const { app, rt, graph, drain } = igApp();
    const changes = { object: "instagram", entry: [{ id: "17841400000000001", changes: [{ field: "messages", value: { sender: { id: IGSID }, recipient: { id: "17841400000000001" }, message: { mid: "mid.c", text: "via changes" } } }] }] };
    await app.request("/webhooks/instagram", signed(changes));
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.u", text: "nobody" }, {}, "17841499999999999")));
    await drain();
    expect(JSON.stringify((await convOf(rt))?.messages)).toContain("via changes");
    expect(graph.sends()).toHaveLength(1);
  });
  it("ignores echoes of its own messages, deleted messages, read receipts, reactions and postbacks", async () => {
    const { app, rt, graph, drain } = igApp();
    const echo = { object: "instagram", entry: [{ id: "17841400000000001", messaging: [{ sender: { id: "17841400000000001" }, recipient: { id: IGSID }, message: { mid: "mid.e", text: "hello", is_echo: true } }] }] };
    await app.request("/webhooks/instagram", signed(echo));
    // 已删的通知按文档没有正文；这里故意带上文字，证明挡住它的是 is_deleted 而不是"没内容"
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.d", text: "gone", is_deleted: true })));
    await app.request("/webhooks/instagram", signed(event({}, { read: { mid: "mid.1" } })));
    await app.request("/webhooks/instagram", signed(event({}, { reaction: { mid: "mid.1", action: "react", emoji: "❤️" } })));
    await app.request("/webhooks/instagram", signed(event({}, { postback: { mid: "mid.p", title: "Yes", payload: "YES" } })));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(await rt.conversations.get("ig:instagram:17841400000000001")).toBeUndefined();
    expect(graph.calls).toHaveLength(0);
  });
  it("fetches an image attachment from its CDN url without the token and hands it to the agent", async () => {
    const { app, rt, graph, drain } = igApp();
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.i", attachments: [{ type: "image", payload: { url: CDN_URL } }] })));
    await drain();
    const cdn = graph.calls.find((c) => c.url.startsWith(CDN_URL));
    expect(cdn).toBeDefined();
    expect(cdn!.headers.authorization).toBeUndefined();
    const conv = await convOf(rt);
    expect([...conv!.images.values()][0]).toEqual({ data: Buffer.from([7, 8, 9]).toString("base64"), mimeType: "image/jpeg" });
    expect(graph.sends()).toHaveLength(1);
  });
  it("caps attachments per turn and tolerates a failed one when another succeeds", async () => {
    const { app, rt, graph, drain } = igApp();
    const many = Array.from({ length: LIMITS.imagesPerTurn + 2 }, (_, i) => ({ type: "image", payload: { url: `${CDN_URL}&n=${i}` } }));
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.m", attachments: many })));
    await drain();
    expect(graph.calls.filter((c) => c.url.startsWith(CDN_URL))).toHaveLength(LIMITS.imagesPerTurn);
    expect((await convOf(rt))?.images.size).toBe(LIMITS.imagesPerTurn);
  });
  it.each([
    ["not an image by content-type", fakeGraph({ cdnType: "image/gif" })],
    ["larger than the cap", fakeGraph({ cdnBytes: new Uint8Array(MEDIA_MAX_BYTES + 1) })],
    ["unreachable", fakeGraph({ cdnStatus: 500 })],
  ])("replies with the canned text when the attachment is %s", async (_label, graph) => {
    const { app, rt, drain } = igApp(igEnv, graph);
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.b", attachments: [{ type: "image", payload: { url: CDN_URL } }] })));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(JSON.parse(graph.sends()[0]!.body!).message.text).toBe(CANNED.mediaFailed);
  });
  it("answers unsupported media (video, share, is_unsupported) with the canned text and never calls the model", async () => {
    const { app, rt, graph, drain } = igApp();
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.v", attachments: [{ type: "video", payload: { url: "https://lookaside.test/v.mp4" } }] })));
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.s", is_unsupported: true })));
    await drain();
    expect(await convOf(rt)).toBeUndefined();
    expect(graph.calls.filter((c) => c.method === "GET")).toHaveLength(0);
    expect(graph.sends().map((s) => JSON.parse(s.body!).message.text)).toEqual([CANNED.unsupported, CANNED.unsupported]);
  });
  it("keeps the caption and lets the model answer when a video comes with text", async () => {
    const { app, rt, graph, drain } = igApp();
    await app.request("/webhooks/instagram", signed(event({ mid: "mid.vt", text: "this is Max", attachments: [{ type: "video", payload: { url: "https://lookaside.test/v.mp4" } }] })));
    await drain();
    expect(JSON.stringify((await convOf(rt))?.messages)).toContain("this is Max");
    expect(JSON.parse(graph.sends()[0]!.body!).message.text).toBe("hello");
  });
  it("processes a redelivered mid only once", async () => {
    const { app, rt, graph, drain } = igApp();
    await app.request("/webhooks/instagram", signed(text("first")));
    await app.request("/webhooks/instagram", signed(text("first")));
    await drain();
    expect((await convOf(rt))?.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(graph.sends()).toHaveLength(1);
  });
  it("parseInstagramPayload drops malformed entries", () => {
    expect(parseInstagramPayload(null)).toEqual([]);
    expect(parseInstagramPayload({ object: "page", entry: [] })).toEqual([]);
    expect(parseInstagramPayload({ object: "instagram", entry: [null, { id: "not-numeric", messaging: [{ sender: { id: IGSID }, message: { mid: "m", text: "x" } }] }] })).toEqual([]);
    expect(parseInstagramPayload({ object: "instagram", entry: [{ id: "1", messaging: [null, { sender: { id: "abc" }, message: { mid: "m", text: "x" } }, { sender: { id: IGSID }, message: { mid: "bad mid!", text: "x" } }, { sender: { id: IGSID }, message: { mid: "ok", text: "x" } }] }] }).map((e) => e.messageId)).toEqual(["ok"]);
  });
  it("chunkByBytes keeps every chunk within the byte budget without splitting code points", () => {
    const zh = "宠物美容报价是一个区间，以到店评估为准。".repeat(60); // 每字 3 字节
    const parts = chunkByBytes(zh, 950);
    expect(parts.join("")).toBe(zh);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(950);
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i} ${"🐶".repeat(20)}`).join("\n");
    const lp = chunkByBytes(lines, 300);
    expect(lp.join("\n")).toBe(lines); // 在换行处断
    for (const p of lp) expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(300);
    expect(chunkByBytes("", 950)).toEqual([""]);
    expect(() => chunkByBytes("x", 3)).toThrow(/maxBytes/);
  });
});
