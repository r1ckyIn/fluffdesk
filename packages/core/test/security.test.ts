import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { isPrivateAddress, safeFetchHtml, UnsafeUrlError } from "../src/shop/importer/safe-fetch.js";
import { importWebsite } from "../src/shop/importer/website.js";
import { newConversation, runTurn, pruneOldImages, type AgentDeps } from "../src/agent/loop.js";
import { defaultTools, holdBookingTool } from "../src/tools/index.js";
import { InMemoryBookingStore, InMemoryCalendar } from "../src/booking/ports.js";
import { LIMITS } from "../src/agent/limits.js";
import { demoShop, fauxGateway } from "./fixtures.js";

/** 公网输入的护栏：SSRF、数量上限、预约刷量 */

const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const publicLookup = async () => ["93.184.216.34"];

describe("safeFetchHtml 防 SSRF", () => {
  it.each([
    "10.0.0.1", "172.16.5.5", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1",
    "::1", "::", "fd00::1", "fe80::1", "fec0::1",
    // 内嵌 IPv4 的各种写法：映射（点分和十六进制）、兼容、NAT64。new URL() 会把点分写法序列化成十六进制
    "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:a00:1", "::7f00:1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe",
  ])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it.each(["http://[::ffff:127.0.0.1]:8787/", "http://[::ffff:169.254.169.254]/latest/meta-data/", "http://[::ffff:a00:1]/", "http://[64:ff9b::10.0.0.1]/"])(
    "rejects a redirect to %s after the url parser rewrites it",
    async (target) => {
      const seen: string[] = [];
      const fetchImpl = (async (url: string) => {
        seen.push(url);
        return url.startsWith("http://good.example") ? new Response(null, { status: 302, headers: { location: target } }) : html("<p>internal</p>");
      }) as unknown as typeof fetch;
      await expect(safeFetchHtml("http://good.example/", { fetch: fetchImpl, lookup: publicLookup })).rejects.toThrow(/private address/);
      expect(seen).toEqual(["http://good.example/"]);
    },
  );
  it("rejects hosts that resolve to private addresses without fetching", async () => {
    let fetched = false;
    const fetchImpl = (async () => { fetched = true; return html(""); }) as unknown as typeof fetch;
    await expect(safeFetchHtml("http://internal.example", { fetch: fetchImpl, lookup: async () => ["10.0.0.5"] })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetched).toBe(false);
  });
  it.each(["file:///etc/passwd", "ftp://x.example/", "http://localhost/", "http://user:pw@x.example/", "http://169.254.169.254/latest/meta-data"])("rejects %s", async (url) => {
    await expect(safeFetchHtml(url, { fetch: (async () => html("")) as never, lookup: publicLookup })).rejects.toBeInstanceOf(UnsafeUrlError);
  });
  it("re-validates every redirect hop", async () => {
    const fetchImpl = (async (url: string) =>
      url.startsWith("http://good.example") ? new Response(null, { status: 302, headers: { location: "http://10.0.0.1/admin" } }) : html("")) as unknown as typeof fetch;
    await expect(safeFetchHtml("http://good.example", { fetch: fetchImpl, lookup: publicLookup })).rejects.toThrow(/private address/);
  });
  it("follows a safe redirect and reports the final url", async () => {
    const fetchImpl = (async (url: string) =>
      url === "http://good.example/" ? new Response(null, { status: 301, headers: { location: "https://www.good.example/" } }) : html("<p>hi</p>")) as unknown as typeof fetch;
    const r = await safeFetchHtml("http://good.example/", { fetch: fetchImpl, lookup: publicLookup });
    expect(r.url).toBe("https://www.good.example/");
  });
  it("caps the number of bytes read", async () => {
    const big = "x".repeat(100_000);
    const r = await safeFetchHtml("http://big.example/", { fetch: (async () => html(big)) as never, lookup: publicLookup, maxBytes: 1000 });
    expect(r.html.length).toBeLessThanOrEqual(1000);
  });
  it("importWebsite turns an unsafe url into an empty draft with the reason", async () => {
    const { gateway } = fauxGateway();
    const d = await importWebsite(gateway, "http://10.1.1.1/", { fetch: (async () => html("")) as never, lookup: publicLookup });
    expect(d.partial).toEqual({});
    expect(d.rawNotes?.[0]).toMatch(/private address/);
  });
});

describe("会话上限", () => {
  function deps(): AgentDeps {
    const { gateway } = fauxGateway();
    return { gateway, shop: demoShop, tools: defaultTools(), toolContext: { bookings: new InMemoryBookingStore(), calendar: new InMemoryCalendar(() => null) }, today: () => "2026-11-01" };
  }
  it("stops calling the model once the conversation hits the message limit", async () => {
    const d = deps();
    const conv = newConversation({ id: "c", shopSlug: demoShop.slug, channel: "web", locale: "zh" });
    for (let i = 0; i < LIMITS.messagesPerConversation; i++) conv.messages.push({ role: "user", content: "x", timestamp: 0 });
    const r = await runTurn(d, conv, { text: "hi" });
    expect(r.stop).toBe("limit");
    expect(r.reply).toMatch(/美容师/);
    expect(r.costUsd).toBe(0);
  });
  it("drops disallowed and excess images", async () => {
    const { faux, gateway } = fauxGateway();
    faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
    const d = { ...deps(), gateway };
    const conv = newConversation({ id: "c", shopSlug: demoShop.slug, channel: "web", locale: "en" });
    const images = [
      { data: "a", mimeType: "image/svg+xml" },
      ...Array.from({ length: LIMITS.imagesPerTurn + 2 }, () => ({ data: "b", mimeType: "image/png" })),
    ];
    await runTurn(d, conv, { text: "look", images });
    expect(conv.images.size).toBe(LIMITS.imagesPerTurn);
    expect([...conv.images.values()].every((i) => i.mimeType === "image/png")).toBe(true);
  });
  it("prunes images from older turns so history does not resend them", () => {
    const img = { type: "image" as const, data: "zz", mimeType: "image/png" };
    const messages = [
      { role: "user" as const, content: [img], timestamp: 0 },
      { role: "assistant" as const, content: [], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" as const, timestamp: 0 },
      { role: "user" as const, content: [img], timestamp: 0 },
    ];
    pruneOldImages(messages, 1);
    expect((messages[0]!.content as Array<{ type: string }>)[0]!.type).toBe("text");
    expect((messages[2]!.content as Array<{ type: string }>)[0]!.type).toBe("image");
  });
});

describe("预约刷量", () => {
  it("hold_booking refuses after the per-conversation pending cap", async () => {
    const { gateway } = fauxGateway();
    const bookings = new InMemoryBookingStore();
    const ctx = { shop: demoShop, conversationId: "c1", channel: "web", gateway, calendar: new InMemoryCalendar(() => null), bookings, images: new Map(), locale: "en" as const };
    const args = { customerName: "A", contact: "0400", serviceId: "bath-tidy", start: "2026-11-03T10:00", pet: { species: "dog" } };
    for (let i = 0; i < LIMITS.pendingBookingsPerConversation; i++) expect((await holdBookingTool.run(args, ctx)).isError).toBeFalsy();
    const r = await holdBookingTool.run(args, ctx);
    expect(r.isError).toBe(true);
    expect(await bookings.countPendingForConversation("c1")).toBe(LIMITS.pendingBookingsPerConversation);
  });
  it("hold_booking rejects a malformed start", async () => {
    const { gateway } = fauxGateway();
    const ctx = { shop: demoShop, conversationId: "c2", channel: "web", gateway, calendar: new InMemoryCalendar(() => null), bookings: new InMemoryBookingStore(), images: new Map(), locale: "en" as const };
    const r = await holdBookingTool.run({ customerName: "A", contact: "0400", serviceId: "bath-tidy", start: "tomorrow 10am", pet: { species: "dog" } }, ctx);
    expect(r.isError).toBe(true);
  });
});
