import { describe, expect, it } from "vitest";
import { Type, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { ToolRegistry, defineTool, type ToolContext } from "../src/tools/registry.js";
import { defaultTools, quoteTool, identifyPetTool, holdBookingTool } from "../src/tools/index.js";
import { InMemoryBookingStore, InMemoryCalendar } from "../src/booking/ports.js";
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
