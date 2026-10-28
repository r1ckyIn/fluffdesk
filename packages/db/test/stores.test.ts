import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { count, eq, sql } from "drizzle-orm";
import { parseShopConfig, Tracer, ATTR, type Conversation } from "@fluffdesk/core";
import * as schema from "../src/schema.js";
import type { Db } from "../src/client.js";
import { PgShopRepo } from "../src/stores/shops.js";
import { PgConversationStore } from "../src/stores/conversations.js";
import { PgBookingStore } from "../src/stores/bookings.js";
import { PgCorrectionStore } from "../src/stores/corrections.js";
import { pgTraceSink } from "../src/stores/traces.js";

/**
 * 数据层的契约。跑在 PGlite（WASM 里的真 Postgres）上，用的是提交进仓库的迁移文件，
 * 所以这里同时验证了迁移能建出 schema.ts 描述的表。CI 不需要数据库。
 */

const shopConfig = (slug: string) =>
  parseShopConfig({
    slug, name: slug.toUpperCase(), timezone: "Australia/Sydney", currency: "AUD",
    hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    sizeTiers: [{ id: "small", label: { en: "S", zh: "小" } }],
    services: [{ id: "bath", name: { en: "Bath", zh: "洗" }, durationMin: 60, prices: [{ size: "small", min: 50, max: 60 }] }],
    policies: { quoteDisclaimer: { en: "in store", zh: "到店" } },
  });

let db: Db;
let shops: PgShopRepo;
let conversations: PgConversationStore;
let bookings: PgBookingStore;

beforeAll(async () => {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../migrations") });
  db = pg;
  shops = new PgShopRepo(db);
  conversations = new PgConversationStore(db);
  bookings = new PgBookingStore(db, undefined, ticking());
}, 60_000);

// 每条用例从空表开始：PGlite 一个连接，存储自己有事务，不能再套一层外部事务回滚，所以用 truncate
beforeEach(async () => {
  await db.execute(sql`truncate ${schema.conversationImages}, ${schema.bookings}, ${schema.traces}, ${schema.corrections}, ${schema.conversations}, ${schema.shops} cascade`);
  await shops.upsert(shopConfig("s1"), { approved: true });
  await shops.upsert(shopConfig("s2"), { approved: true });
});

/** 可控时钟：每调一次往后走一秒。两次 decide 落在同一毫秒时 decided_at 会平手，排序就不稳定 */
const ticking = () => {
  let t = Date.parse("2026-10-28T00:00:00Z");
  return () => new Date((t += 1000));
};

const pendingInput = (conv: Conversation, shopSlug = conv.shopSlug) => ({
  shopSlug,
  conversationId: conv.id,
  customer: { name: "Amy", contact: "0400 000 000", channel: conv.channel },
  pet: { species: "dog" as const, name: "Milo", sizeTier: "small" },
  serviceId: "bath",
  start: "2026-11-03T10:00",
  durationMin: 60,
  quote: { min: 50, max: 60, currency: "AUD" as const },
});

describe("PgShopRepo", () => {
  it("hides shops until they are approved", async () => {
    await shops.upsert(shopConfig("draft"), { approved: false });
    expect(await shops.get("draft")).toBeUndefined();
    expect((await shops.list()).map((s) => s.slug)).not.toContain("draft");
    await shops.upsert({ ...shopConfig("draft"), name: "Approved" }, { approved: true });
    expect((await shops.get("draft"))?.name).toBe("Approved");
  });
  it("a draft never overwrites an approved shop, an approved write always does", async () => {
    await shops.upsert({ ...shopConfig("live"), name: "Live" }, { approved: true });
    const draft = await shops.upsert({ ...shopConfig("live"), name: "Scraped draft" }, { approved: false });
    expect(draft.written).toBe(false);
    expect((await shops.get("live"))?.name).toBe("Live");
    const again = await shops.upsert({ ...shopConfig("live"), name: "Edited by groomer" }, { approved: true });
    expect(again.written).toBe(true);
    expect((await shops.get("live"))?.name).toBe("Edited by groomer");
  });
  it("save edits an approved shop in place and never touches drafts or unknown slugs", async () => {
    await shops.upsert(shopConfig("draft"), { approved: false });
    expect(await shops.save({ ...shopConfig("s1"), name: "Renamed" })).toBe(true);
    expect((await shops.get("s1"))?.name).toBe("Renamed");
    expect(await shops.save({ ...shopConfig("draft"), name: "Sneaky" })).toBe(false);
    expect(await shops.get("draft")).toBeUndefined();
    expect(await shops.save(shopConfig("ghost"))).toBe(false);
    expect((await shops.list()).map((s) => s.slug)).not.toContain("ghost");
  });
  it("rejects a config that fails the core schema or its reference checks", async () => {
    await expect(shops.upsert({ slug: "bad" }, { approved: true })).rejects.toThrow();
    expect(await shops.get("bad")).toBeUndefined();
    const dup = shopConfig("dup");
    await expect(shops.upsert({ ...dup, services: [...dup.services, { ...dup.services[0]! }] }, { approved: true })).rejects.toThrow(/duplicate id/);
    expect(await shops.get("dup")).toBeUndefined();
    const s1 = shopConfig("s1");
    await expect(shops.save({ ...s1, services: [{ ...s1.services[0]!, prices: [{ ...s1.services[0]!.prices[0]!, size: "giant" }] }] })).rejects.toThrow(/unknown size tier/);
  });
});

describe("PgConversationStore", () => {
  it("finds the same conversation for the same key and a new one for another channel", async () => {
    const a = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "sess-1" }, "zh");
    const b = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "sess-1" }, "en");
    const c = await conversations.findOrCreate({ shopSlug: "s1", channel: "instagram", externalId: "sess-1" }, "en");
    expect(b.id).toBe(a.id);
    expect(b.locale).toBe("zh"); // locale 只在新建时生效
    expect(c.id).not.toBe(a.id);
    expect(a.id).toMatch(/^cv_/);
  });
  it("two first messages arriving together still end up in one conversation", async () => {
    const key = { shopSlug: "s1", channel: "web", externalId: "race" };
    const [a, b] = await Promise.all([conversations.findOrCreate(key, "en"), conversations.findOrCreate(key, "en")]);
    expect(a.id).toBe(b.id);
  });
  it("persists messages and appends images without rewriting the ones already stored", async () => {
    const key = { shopSlug: "s1", channel: "web", externalId: "imgs" };
    const conv = await conversations.findOrCreate(key, "en");
    conv.messages.push({ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 });
    conv.images.set("img_1", { data: "AAAA", mimeType: "image/png" });
    await conversations.save(conv);
    conv.messages.push({ role: "user", content: [{ type: "text", text: "again" }], timestamp: 2 });
    conv.images.set("img_2", { data: "BBBB", mimeType: "image/jpeg" });
    await conversations.save(conv);

    const fresh = await new PgConversationStore(db).findOrCreate(key, "en");
    expect(fresh.messages).toHaveLength(2);
    expect([...fresh.images.keys()]).toEqual(["img_1", "img_2"]);
    expect(fresh.images.get("img_2")).toEqual({ data: "BBBB", mimeType: "image/jpeg" });
    const [row] = await db.select({ n: count() }).from(schema.conversationImages).where(eq(schema.conversationImages.conversationId, conv.id));
    expect(row?.n).toBe(2);
  });
  it("get by id returns the conversation with its images, or nothing", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "by-id" }, "zh");
    conv.images.set("img_1", { data: "AAAA", mimeType: "image/png" });
    await conversations.save(conv);
    const got = await new PgConversationStore(db).get(conv.id);
    expect(got).toMatchObject({ id: conv.id, shopSlug: "s1", locale: "zh" });
    expect(got?.images.get("img_1")).toEqual({ data: "AAAA", mimeType: "image/png" });
    expect(await conversations.get("cv_missing")).toBeUndefined();
  });
  it("expires images of idle conversations but keeps the text history", async () => {
    const idleKey = { shopSlug: "s1", channel: "web", externalId: "idle" };
    const idle = await conversations.findOrCreate(idleKey, "en");
    idle.messages.push({ role: "user", content: [{ type: "text", text: "[image attached, imageId=img_1]" }, { type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: 1 });
    idle.images.set("img_1", { data: "AAAA", mimeType: "image/png" });
    await conversations.save(idle);
    const activeKey = { shopSlug: "s1", channel: "web", externalId: "active" };
    const active = await conversations.findOrCreate(activeKey, "en");
    active.images.set("img_1", { data: "BBBB", mimeType: "image/png" });
    await conversations.save(active);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.update(schema.conversations).set({ updatedAt: new Date(dayAgo.getTime() - 1000) }).where(eq(schema.conversations.id, idle.id));

    expect(await conversations.expireIdleImages(dayAgo)).toBe(1);
    const reloadedIdle = await new PgConversationStore(db).findOrCreate(idleKey, "en");
    expect(reloadedIdle.images.size).toBe(0);
    expect(reloadedIdle.messages).toHaveLength(1);
    expect(JSON.stringify(reloadedIdle.messages)).not.toContain('"type":"image"');
    expect(JSON.stringify(reloadedIdle.messages)).toContain("imageId=img_1");
    const reloadedActive = await new PgConversationStore(db).findOrCreate(activeKey, "en");
    expect(reloadedActive.images.size).toBe(1);
    expect(await conversations.expireIdleImages(dayAgo)).toBe(0); // 第二次没有可清的
  });
});

describe("PgBookingStore", () => {
  it("creates pending bookings and lists them per shop", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-list" }, "en");
    const other = await conversations.findOrCreate({ shopSlug: "s2", channel: "web", externalId: "bk-list" }, "en");
    const b = await bookings.createPending(pendingInput(conv));
    await bookings.createPending(pendingInput(other));
    expect(b.id).toMatch(/^bk_/);
    expect(b.status).toBe("pending");
    expect(await bookings.get(b.id)).toEqual(b);
    expect((await bookings.listPending("s1")).map((x) => x.id)).toContain(b.id);
    expect((await bookings.listPending("s1")).every((x) => x.shopSlug === "s1")).toBe(true);
    expect((await bookings.listPendingForConversation(conv.id)).map((x) => x.id)).toEqual([b.id]);
    expect(await bookings.listPendingForConversation(other.id)).toHaveLength(1);
  });
  it("lists a day's confirmed bookings by start, ignoring other days, pending and declined ones", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-day" }, "en");
    const at = (start: string) => ({ ...pendingInput(conv), start });
    const late = await bookings.createPending(at("2026-11-05T14:00"));
    const early = await bookings.createPending(at("2026-11-05T09:00"));
    const other = await bookings.createPending(at("2026-11-06T09:00"));
    const declined = await bookings.createPending(at("2026-11-05T10:00"));
    await bookings.createPending(at("2026-11-05T11:00")); // pending
    for (const b of [late, early, other]) await bookings.decide(b.id, { status: "confirmed", by: "g" });
    await bookings.decide(declined.id, { status: "declined", by: "g" });
    expect((await bookings.listConfirmedOn("s1", "2026-11-05")).map((b) => b.id)).toEqual([early.id, late.id]);
    expect(await bookings.listConfirmedOn("s2", "2026-11-05")).toEqual([]);
  });
  it("only a pending booking can be decided, and only once", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-decide" }, "en");
    const b = await bookings.createPending(pendingInput(conv));
    const decided = await bookings.decide(b.id, { status: "declined", by: "groomer-1", reason: "full" });
    expect(decided).toMatchObject({ status: "declined", decidedBy: "groomer-1", declineReason: "full" });
    expect(decided.decidedAt).toBeDefined();
    await expect(bookings.decide(b.id, { status: "confirmed", by: "groomer-2" })).rejects.toThrow(/already declined/);
    expect((await bookings.get(b.id))?.status).toBe("declined");
    await expect(bookings.decide("bk_missing", { status: "confirmed", by: "g" })).rejects.toThrow(/not found/);
    expect(await bookings.listPendingForConversation(conv.id)).toHaveLength(0);
  });
  it("the same slot requested twice at once yields one pending booking, which can then be updated in place", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-slot" }, "en");
    const [a, b] = await Promise.all([bookings.createPending(pendingInput(conv)), bookings.createPending(pendingInput(conv))]);
    expect(b.id).toBe(a.id);
    expect(await bookings.listPendingForConversation(conv.id)).toHaveLength(1);
    const updated = await bookings.updatePending(a.id, { ...pendingInput(conv), customer: { name: "Amy", contact: "0411", channel: "web" } });
    expect(updated).toMatchObject({ id: a.id, status: "pending", customer: { contact: "0411" } });
    const stranger = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-stranger" }, "en");
    await expect(bookings.updatePending(a.id, pendingInput(stranger))).rejects.toThrow(/not found/);
    await bookings.decide(a.id, { status: "declined", by: "g" });
    await expect(bookings.updatePending(a.id, pendingInput(conv))).rejects.toThrow(/already declined/);
    // 决定过的不占槽位：同时段可以再挂一条新的待确认
    const again = await bookings.createPending(pendingInput(conv));
    expect(again.id).not.toBe(a.id);
  });
  it("alternatives are stored with a decline only, and the history lists a shop's decided bookings newest first", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-alt" }, "en");
    const other = await conversations.findOrCreate({ shopSlug: "s2", channel: "web", externalId: "bk-alt" }, "en");
    const a = await bookings.createPending(pendingInput(conv));
    const b = await bookings.createPending({ ...pendingInput(conv), start: "2026-11-03T11:00" });
    const c = await bookings.createPending({ ...pendingInput(conv), start: "2026-11-03T12:00" });
    await bookings.createPending(pendingInput(other));
    const confirmed = await bookings.decide(a.id, { status: "confirmed", by: "g", alternatives: ["2026-11-04T10:00"] } as never);
    expect(confirmed.alternatives).toBeUndefined();
    const declined = await bookings.decide(b.id, { status: "declined", by: "g", alternatives: ["2026-11-04T10:00", "2026-11-04T11:00"] });
    expect(declined.alternatives).toEqual(["2026-11-04T10:00", "2026-11-04T11:00"]);
    expect((await bookings.get(b.id))?.alternatives).toEqual(["2026-11-04T10:00", "2026-11-04T11:00"]);
    const history = await bookings.listByStatus("s1", ["confirmed", "declined"]);
    expect(history.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(await bookings.listByStatus("s1", ["pending"])).toHaveLength(1);
    expect((await bookings.listByStatus("s1", ["pending"]))[0]?.id).toBe(c.id);
    expect(await bookings.listByStatus("s1", ["confirmed", "declined"], 1)).toHaveLength(1);
    expect(await bookings.listByStatus("s2", ["confirmed", "declined"])).toHaveLength(0);
  });
  it("same-instant decisions list newest-created first, like the in-memory store", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-tie" }, "en");
    const frozen = new Date("2026-10-29T00:00:00Z");
    const store = new PgBookingStore(db, undefined, () => frozen);
    const older = await bookings.createPending({ ...pendingInput(conv), start: "2026-11-07T09:00" });
    const newer = await bookings.createPending({ ...pendingInput(conv), start: "2026-11-07T10:00" });
    await store.decide(older.id, { status: "confirmed", by: "g" });
    await store.decide(newer.id, { status: "declined", by: "g" });
    const ids = (await bookings.listByStatus("s1", ["confirmed", "declined"])).map((b) => b.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    expect(ids.indexOf(older.id)).toBe(ids.indexOf(newer.id) + 1);
  });
  it("two groomers deciding at once: exactly one wins", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "bk-race" }, "en");
    const b = await bookings.createPending(pendingInput(conv));
    const results = await Promise.allSettled([
      bookings.decide(b.id, { status: "confirmed", by: "a" }),
      bookings.decide(b.id, { status: "declined", by: "b" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("PgCorrectionStore", () => {
  it("stores corrections per shop in order", async () => {
    const store = new PgCorrectionStore(db);
    await store.add({ id: "cor_1", shopSlug: "s1", conversationId: "cv_x", kind: "quote", original: { min: 1 }, corrected: { min: 2 }, by: "g", createdAt: "2026-10-28T00:00:00.000Z" });
    await store.add({ id: "cor_2", shopSlug: "s1", conversationId: "cv_x", kind: "reply", original: null, corrected: "better", note: "tone", by: "g", createdAt: "2026-10-28T00:00:01.000Z" });
    await store.add({ id: "cor_3", shopSlug: "s2", conversationId: "cv_y", kind: "reply", original: null, corrected: null, by: "g", createdAt: "2026-10-28T00:00:02.000Z" });
    const s1 = await store.list("s1");
    expect(s1.map((c) => c.id)).toEqual(["cor_1", "cor_2"]);
    expect(s1[0]).toMatchObject({ kind: "quote", original: { min: 1 }, corrected: { min: 2 }, by: "g", createdAt: "2026-10-28T00:00:00.000Z" });
    expect(s1[1]?.note).toBe("tone");
  });
});

describe("pgTraceSink", () => {
  it("stores a finished trace with its shop and cost", async () => {
    const conv = await conversations.findOrCreate({ shopSlug: "s1", channel: "web", externalId: "trace" }, "en");
    const tracer = new Tracer(conv.id, [pgTraceSink(db)]);
    const span = tracer.start("agent.turn", { [ATTR.shop]: "s1" });
    tracer.end(span, { [ATTR.costUsd]: 0.0123 });
    const trace = await tracer.finish();
    const [row] = await db.select().from(schema.traces).where(eq(schema.traces.id, trace.id));
    expect(row).toMatchObject({ conversationId: conv.id, shopSlug: "s1", costUsd: "0.0123" });
    expect(row?.trace.spans).toHaveLength(1);
  });
  it("never throws into the agent loop when the write fails", async () => {
    const tracer = new Tracer("cv_does_not_exist", [pgTraceSink(db)]);
    tracer.end(tracer.start("agent.turn"));
    const trace = await tracer.finish(); // 外键挂了也要把轨迹还给循环
    expect(trace.id).toBe(tracer.trace.id);
    expect(await db.select().from(schema.traces).where(eq(schema.traces.id, trace.id))).toHaveLength(0);
  });
});
