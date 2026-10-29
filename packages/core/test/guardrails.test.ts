import { describe, expect, it } from "vitest";
import { Type, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { ToolRegistry, defineTool, type ToolContext } from "../src/tools/registry.js";
import { defaultTools, quoteTool, identifyPetTool, holdBookingTool } from "../src/tools/index.js";
import { InMemoryBookingStore, InMemoryCalendar, bookingSlot } from "../src/booking/ports.js";
import { parseDecision } from "../src/booking/decision.js";
import { parseShopConfig, validateShopConfig } from "../src/shop/schema.js";
import { channelBindingConflicts, ChannelBindingConflictError, InMemoryShopRepo } from "../src/shop/repo.js";
import { transcript } from "../src/agent/transcript.js";
import { newConversation } from "../src/agent/loop.js";
import { demoShop, fauxGateway } from "./fixtures.js";

/**
 * CLAUDE.md 里的规矩在代码上的护栏。变异测试发现这几条原来只有类型和提示词守着，
 * 改坏了测试照样全绿，所以单独立一组。
 */
function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    shop: demoShop,
    conversationId: "c",
    channel: "test",
    gateway: fauxGateway().gateway,
    calendar: new InMemoryCalendar(() => ({ open: "09:00", close: "17:00" })),
    bookings: new InMemoryBookingStore(),
    images: new Map(),
    locale: "en",
    ...overrides,
  };
}

describe("写操作必须等美容师确认", () => {
  it("registry refuses write-level tools even when the type is bypassed", () => {
    const writeTool = defineTool({
      permission: "write" as never,
      definition: { name: "write_calendar", description: "x", parameters: Type.Object({}) },
      run: async () => ({ text: "" }),
    });
    expect(() => new ToolRegistry().register(writeTool)).toThrow(/write-level/);
  });
  it("default tool set has no write-level tool", () => {
    const names = defaultTools().definitions().map((t) => t.name);
    for (const n of names) expect(defaultTools().get(n)?.permission).not.toBe("write");
  });
  it("hold_booking can only produce a pending booking, whatever the caller passes", async () => {
    const c = ctx();
    await holdBookingTool.run({ customerName: "A", contact: "0400", serviceId: "bath-tidy", start: "2026-11-03T10:00", pet: { species: "dog", sizeTier: "small" } }, c);
    const store = c.bookings as InMemoryBookingStore;
    const [b] = await store.listPending(demoShop.slug);
    expect(b?.status).toBe("pending");
    // 挂的必须是客人要的那个服务，时长跟着服务走
    expect(b?.serviceId).toBe("bath-tidy");
    expect(b?.durationMin).toBe(60);
    // 即使有人把 status 塞进 createPending 的入参，也会被覆盖成 pending
    const forced = await store.createPending({ ...(b as never), status: "confirmed" } as never);
    expect(forced.status).toBe("pending");
  });
  it("hold_booking called again for the same slot updates the pending booking instead of adding a second one", async () => {
    const c = ctx();
    const args = { customerName: "A", contact: "0400", serviceId: "bath-tidy", start: "2026-11-03T10:00", pet: { species: "dog", sizeTier: "small" } };
    const first = await holdBookingTool.run(args, c);
    const second = await holdBookingTool.run({ ...args, contact: "0411", pet: { species: "dog", sizeTier: "medium" } }, c);
    expect(second.isError).not.toBe(true);
    expect(second.details).toMatchObject({ bookingId: (first.details as { bookingId: string }).bookingId, updated: true });
    const store = c.bookings as InMemoryBookingStore;
    const pending = await store.listPending(demoShop.slug);
    expect(pending).toHaveLength(1);
    // 客人改的联系方式和体型进了同一条，报价跟着体型重算，状态还是 pending
    expect(pending[0]).toMatchObject({ status: "pending", customer: { contact: "0411" }, pet: { sizeTier: "medium" }, quote: { min: 80, max: 100 } });
    // 换个时段就是新的请求
    await holdBookingTool.run({ ...args, start: "2026-11-03T11:00" }, c);
    expect(await store.listPending(demoShop.slug)).toHaveLength(2);
  });
  it("a decided booking cannot be rewritten through updatePending", async () => {
    const store = new InMemoryBookingStore();
    const input = { shopSlug: "s", conversationId: "c", customer: { name: "A", contact: "0", channel: "t" }, pet: { species: "dog" as const }, serviceId: "x", start: "2026-11-03T10:00", durationMin: 60 };
    const b = await store.createPending(input);
    await store.decide(b.id, { status: "confirmed", by: "g" });
    await expect(store.updatePending(b.id, { ...input, customer: { ...input.customer, contact: "9" } })).rejects.toThrow(/already confirmed/);
    expect((await store.get(b.id))?.customer.contact).toBe("0");
  });
  it("hold_booking rejects an unknown service instead of booking something else", async () => {
    const c = ctx();
    const r = await holdBookingTool.run({ customerName: "A", contact: "0400", serviceId: "spa-day", start: "2026-11-03T10:00", pet: { species: "dog" } }, c);
    expect(r.isError).toBe(true);
    expect(await (c.bookings as InMemoryBookingStore).listPending(demoShop.slug)).toHaveLength(0);
  });
  it("only decide() moves a booking out of pending, and only once", async () => {
    const store = new InMemoryBookingStore();
    const b = await store.createPending({ shopSlug: "s", conversationId: "c", customer: { name: "A", contact: "0", channel: "t" }, pet: { species: "dog" }, serviceId: "x", start: "2026-11-03T10:00", durationMin: 60 });
    const decided = await store.decide(b.id, { status: "confirmed", by: "groomer-1" });
    expect(decided.status).toBe("confirmed");
    expect(decided.decidedBy).toBe("groomer-1");
    await expect(store.decide(b.id, { status: "declined", by: "groomer-1" })).rejects.toThrow(/already confirmed/);
  });
});

describe("报价必须带免责声明且不超价目表", () => {
  it("quote tool text carries the shop disclaimer in the customer's locale", async () => {
    const en = await quoteTool.run({ serviceId: "full-groom", size: "medium" }, ctx({ locale: "en" }));
    const zh = await quoteTool.run({ serviceId: "full-groom", size: "medium" }, ctx({ locale: "zh" }));
    expect(en.text).toContain(demoShop.policies.quoteDisclaimer.en);
    expect(zh.text).toContain(demoShop.policies.quoteDisclaimer.zh);
    expect(en.text).toContain("120-160");
  });
  it("quote tool returns an error result, not a number, for unknown service or size", async () => {
    const r = await quoteTool.run({ serviceId: "spa-day", size: "medium" }, ctx());
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/\d{2,}/);
  });
});

describe("识图边界", () => {
  it("missing image returns an error result instead of calling the vision model", async () => {
    const c = ctx();
    const r = await identifyPetTool.run({ imageId: "img_9" }, c);
    expect(r.isError).toBe(true);
  });
  it("unparseable vision output returns an error result instead of throwing", async () => {
    const { faux, gateway } = fauxGateway();
    faux.setResponses([fauxAssistantMessage([fauxText("I think it is a dog")])]);
    const c = ctx({ gateway, images: new Map([["img_1", { data: "", mimeType: "image/png" }]]) });
    const r = await identifyPetTool.run({ imageId: "img_1" }, c);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/could not parse/);
  });
});

describe("美容师端的决定", () => {
  it("alternatives only ride on a decline, at most three, distinct, in the booking's time format", () => {
    expect(() => parseDecision({ status: "confirmed", by: "g", alternatives: ["2026-11-04T10:00"] })).toThrow(/declined/);
    expect(() => parseDecision({ status: "declined", by: "g", alternatives: ["2026-11-04T10:00", "2026-11-04T11:00", "2026-11-04T12:00", "2026-11-04T13:00"] })).toThrow(/at most 3/);
    expect(() => parseDecision({ status: "declined", by: "g", alternatives: ["2026-11-04T10:00", "2026-11-04T10:00"] })).toThrow(/distinct/);
    expect(() => parseDecision({ status: "declined", by: "g", alternatives: ["2026-11-04T10:00:00"] })).toThrow(/YYYY-MM-DDTHH:MM/);
    expect(() => parseDecision({ status: "declined", by: "g", alternatives: "2026-11-04T10:00" })).toThrow(/array/);
    expect(() => parseDecision({ status: "cancelled", by: "g" })).toThrow(/status/);
    expect(() => parseDecision({ status: "confirmed", by: "  " })).toThrow(/by/);
    expect(parseDecision({ status: "declined", by: "g", alternatives: [] })).toEqual({ status: "declined", by: "g" });
    // 超长的 by 和 reason 被截短：是输入的前缀、比输入短，具体截到多长是产品参数，不在这里断言
    const long = parseDecision({ status: "declined", by: ` ${"g".repeat(1000)} `, reason: "x".repeat(5000), alternatives: ["2026-11-04T11:00", "2026-11-04T10:00"] });
    expect(long.alternatives).toEqual(["2026-11-04T10:00", "2026-11-04T11:00"]);
    expect(long.by.length).toBeGreaterThan(0);
    expect(long.by.length).toBeLessThan(1000);
    expect("g".repeat(1000).startsWith(long.by)).toBe(true);
    expect(long.reason!.length).toBeLessThan(5000);
    expect("x".repeat(5000).startsWith(long.reason!)).toBe(true);
  });
  it("the in-memory store keeps alternatives only for a decline, like the Postgres one", async () => {
    const store = new InMemoryBookingStore();
    const mk = () => store.createPending({ shopSlug: "s", conversationId: "c", customer: { name: "A", contact: "0", channel: "web" }, pet: { species: "dog" }, serviceId: "x", durationMin: 60, start: "2026-11-03T10:00" });
    const a = await mk();
    const confirmed = await store.decide(a.id, { status: "confirmed", by: "g", alternatives: ["2026-11-04T10:00"] });
    expect(confirmed.alternatives).toBeUndefined();
  });
  it("a confirmed booking takes its slot out of the calendar", async () => {
    const store = new InMemoryBookingStore();
    const b = await store.createPending({ shopSlug: "s", conversationId: "c", customer: { name: "A", contact: "0", channel: "web" }, pet: { species: "dog" }, serviceId: "x", durationMin: 90, start: "2026-11-03T10:00" });
    await store.decide(b.id, { status: "confirmed", by: "g" });
    const calendar = new InMemoryCalendar(
      () => ({ open: "09:00", close: "13:00" }),
      async (date) => (await store.listConfirmedOn("s", date)).map(bookingSlot),
    );
    expect(bookingSlot(b)).toEqual({ start: "2026-11-03T10:00", end: "2026-11-03T11:30" });
    expect((await calendar.freeSlots("2026-11-03", 60)).map((s) => s.start)).toEqual(["2026-11-03T09:00", "2026-11-03T12:00"]);
    expect((await calendar.freeSlots("2026-11-04", 60)).map((s) => s.start)).toHaveLength(4);
  });
});

describe("按日期查已确认的预约", () => {
  it("listConfirmedOn returns that day's confirmed bookings in start order and nothing else", async () => {
    const store = new InMemoryBookingStore();
    const mk = (conversationId: string, start: string) => store.createPending({ shopSlug: "s", conversationId, customer: { name: "A", contact: "0", channel: "web" }, pet: { species: "dog" }, serviceId: "x", durationMin: 60, start });
    const late = await mk("c1", "2026-11-03T14:00");
    const early = await mk("c2", "2026-11-03T09:00");
    const other = await mk("c3", "2026-11-04T09:00");
    const declined = await mk("c4", "2026-11-03T10:00");
    await mk("c5", "2026-11-03T11:00"); // pending
    for (const b of [late, early, other]) await store.decide(b.id, { status: "confirmed", by: "g" });
    await store.decide(declined.id, { status: "declined", by: "g" });
    expect((await store.listConfirmedOn("s", "2026-11-03")).map((b) => b.id)).toEqual([early.id, late.id]);
    expect(await store.listConfirmedOn("other-shop", "2026-11-03")).toEqual([]);
  });
});

describe("历史列表的次序", () => {
  it("same-instant decisions fall back to newest-created first, like the Postgres store", async () => {
    let t = Date.parse("2026-10-28T00:00:00Z");
    const store = new InMemoryBookingStore(undefined, () => new Date(t).toISOString());
    const mk = (conversationId: string, start: string) => store.createPending({ shopSlug: "s", conversationId, customer: { name: "A", contact: "0", channel: "web" }, pet: { species: "dog" }, serviceId: "x", durationMin: 60, start });
    const older = await mk("c1", "2026-11-03T09:00");
    t += 1000;
    const newer = await mk("c2", "2026-11-03T10:00");
    t += 1000; // 两条在同一时刻被决定
    await store.decide(older.id, { status: "confirmed", by: "g" });
    await store.decide(newer.id, { status: "declined", by: "g" });
    expect((await store.listByStatus("s", ["confirmed", "declined"])).map((b) => b.id)).toEqual([newer.id, older.id]);
  });
});

describe("店铺资料的引用完整性", () => {
  const base = JSON.parse(JSON.stringify(demoShop)) as typeof demoShop;
  it("the write boundary rejects duplicate service ids, duplicate tier ids and prices that point at a missing tier", () => {
    expect(() => validateShopConfig({ ...base, services: [...base.services, { ...base.services[0] }] })).toThrow(/duplicate id/);
    expect(() => validateShopConfig({ ...base, sizeTiers: [...base.sizeTiers, { ...base.sizeTiers[0] }] })).toThrow(/duplicate id/);
    const dangling = { ...base, services: [{ ...base.services[0]!, prices: [{ ...base.services[0]!.prices[0]!, size: "giant" }] }] };
    expect(() => validateShopConfig(dangling)).toThrow(/unknown size tier "giant"/);
    expect(validateShopConfig(base).slug).toBe(base.slug); // 原样的 demo 店通过
  });
  it("the read path still loads a stored config with a dangling price, so the shop can be opened and repaired", () => {
    const dangling = { ...base, services: [{ ...base.services[0]!, prices: [{ ...base.services[0]!.prices[0]!, size: "giant" }] }] };
    expect(parseShopConfig(dangling).slug).toBe(base.slug);
  });
  it("a channel account id can be bound to one shop only; a shop's own existing binding is not a conflict", () => {
    const a = parseShopConfig({ ...base, slug: "a", channels: { whatsapp: { phoneNumberId: "pn-1" }, instagram: { accountId: "ig-1" } } });
    const b = parseShopConfig({ ...base, slug: "b" });
    expect(channelBindingConflicts([a, b], parseShopConfig({ ...base, slug: "b", channels: { whatsapp: { phoneNumberId: "pn-1" } } }))).toEqual([{ channel: "whatsapp", slug: "a" }]);
    expect(channelBindingConflicts([a, b], parseShopConfig({ ...base, slug: "b", channels: { instagram: { accountId: "ig-1" } } }))).toEqual([{ channel: "instagram", slug: "a" }]);
    expect(channelBindingConflicts([a, b], a)).toEqual([]);
    expect(channelBindingConflicts([a, b], parseShopConfig({ ...base, slug: "b", channels: { whatsapp: { phoneNumberId: "pn-2" } } }))).toEqual([]);
    expect(channelBindingConflicts([a, b], b)).toEqual([]);
  });
  it("the in-memory editor refuses a conflicting binding with the typed error and leaves the shop untouched", async () => {
    const a = parseShopConfig({ ...base, slug: "a", channels: { whatsapp: { phoneNumberId: "pn-1" } } });
    const b = parseShopConfig({ ...base, slug: "b", name: "B" });
    const repo = new InMemoryShopRepo([a, b]);
    await expect(repo.save({ ...b, channels: { whatsapp: { phoneNumberId: "pn-1" } } })).rejects.toBeInstanceOf(ChannelBindingConflictError);
    expect((await repo.get("b"))?.channels).toBeUndefined();
    expect(await repo.save({ ...a, name: "A again" })).toBe(true); // 自己的绑定不冲突
  });
});

describe("美容师端只看到会话的文字和图片 id", () => {
  it("transcript drops base64, system prompts and thinking, keeps text, image ids and tool outcomes", () => {
    const conv = newConversation({ id: "c", shopSlug: "s", channel: "web", locale: "en" });
    conv.images.set("img_1", { data: "QUJD", mimeType: "image/png" });
    conv.messages.push(
      { role: "system", content: "secret system prompt" } as never,
      { role: "user", content: [{ type: "text", text: "how much for Milo?" }, { type: "text", text: "[image attached, imageId=img_1]" }, { type: "image", data: "QUJD", mimeType: "image/png" }], timestamp: 1 },
      { role: "user", content: [{ type: "text", text: "[image attached, imageId=img_2]" }, { type: "text", text: "[image omitted from history]" }], timestamp: 2 },
      { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "toolCall", id: "t1", name: "quote", arguments: {} }], api: "x", provider: "p", model: "m" } as never,
      { role: "toolResult", toolCallId: "t1", toolName: "quote", content: [{ type: "text", text: "$90-120" }], isError: false, timestamp: 3 } as never,
      { role: "assistant", content: [{ type: "text", text: "Around $90-120." }], api: "x", provider: "p", model: "m" } as never,
    );
    const entries = transcript(conv);
    expect(entries).toEqual([
      { role: "customer", text: "how much for Milo?", imageIds: ["img_1"], at: 1 },
      { role: "tool", text: "$90-120", at: 3, tool: { name: "quote", isError: false } },
      { role: "agent", text: "Around $90-120.", at: undefined },
    ]);
    const dump = JSON.stringify(entries);
    expect(dump).not.toContain("QUJD");
    expect(dump).not.toContain("secret");
    expect(dump).not.toContain("hmm");
    expect(dump).not.toContain("img_2"); // 已清掉的图不列
  });
});
