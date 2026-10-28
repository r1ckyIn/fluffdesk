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
  it("corrections are built from named fields, not the raw body", async () => {
    const rt = testRuntime();
    const app = createApp(rt, { GROOMER_API_TOKEN: TOKEN });
    const r = await app.request("/groomer/s1/corrections", json({ kind: "quote", conversationId: "c", by: "g", original: 1, corrected: 2, shopSlug: "other", id: "forged", createdAt: "1999" }, auth));
    expect(r.status).toBe(201);
    const [stored] = await rt.corrections.list("s1");
    expect(stored).toMatchObject({ shopSlug: "s1", kind: "quote" });
    expect(stored?.id).not.toBe("forged");
    expect(stored?.createdAt).not.toBe("1999");
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
