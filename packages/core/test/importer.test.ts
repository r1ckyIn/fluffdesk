import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { fauxGateway } from "./fixtures.js";
import { extractShopDraft, verifyDraft, type Draft } from "../src/shop/importer/extract.js";
import { importWebsite } from "../src/shop/importer/website.js";
import { importGoogleBusiness, mapHours } from "../src/shop/importer/google.js";
import { mergeDrafts, mergeServices, LOW_CONFIDENCE } from "../src/shop/importer/index.js";
import { htmlToText, extractLinks } from "../src/shop/importer/html.js";

/** 假 DNS：测试里的域名不存在，安全抓取要先解析再放行 */
const publicLookup = async () => ["93.184.216.34"];

const SITE_HTML = `<html><head><title>Fluffy Paws</title><style>.x{}</style></head><body>
<h1>Fluffy Paws Newtown</h1><p>Call 02 9555 1234. 12 King St, Newtown NSW 2042</p>
<nav><a href="/pricing">Pricing</a><a href="/blog/post-1">Blog</a><a href="https://instagram.com/fluffy">IG</a></nav>
<p>Open Tue-Sat 9am - 5pm</p></body></html>`;
const PRICING_HTML = `<html><body><h2>Prices</h2><ul>
<li>Full groom small (under 10kg) $90 - $120</li><li>Full groom medium $120 - $160</li>
<li>Bath &amp; tidy small from $60</li></ul></body></html>`;

const goodDraft: Draft = {
  name: "Fluffy Paws Newtown",
  phone: "02 9555 1234",
  hours: { tue: { open: "09:00", close: "17:00" }, sat: { open: "09:00", close: "17:00" } },
  sizeTiers: [{ id: "small", label: { en: "Small", zh: "小型" }, maxKg: 10 }, { id: "medium", label: { en: "Medium", zh: "中型" } }],
  services: [
    { id: "full-groom", name: { en: "Full groom", zh: "全套美容" }, prices: [{ size: "small", min: 90, max: 120 }, { size: "medium", min: 120, max: 160 }], evidence: "Full groom small (under 10kg) $90 - $120 Full groom medium $120 - $160" },
    { id: "nail-trim", name: { en: "Nail trim", zh: "剪指甲" }, prices: [{ size: "small", min: 15, max: 15 }], evidence: "Nail trim $15" },
  ],
  unsure: ["bath & tidy only states a 'from' price"],
};

describe("verifyDraft", () => {
  it("drops services whose evidence or numbers are not in the source", () => {
    const text = htmlToText(SITE_HTML) + "\n" + htmlToText(PRICING_HTML);
    const d = verifyDraft(goodDraft, { source: { type: "website", fetchedAt: "" }, text });
    expect(d.partial.services?.map((s) => s.id)).toEqual(["full-groom"]);
    expect(d.confidence.services).toBeLessThan(LOW_CONFIDENCE);
    expect(d.confidence.phone).toBe(1);
    // 只说了两天，必须低于标红线，不锁具体数值
    expect(d.confidence.hours).toBeLessThan(LOW_CONFIDENCE);
    expect(d.rawNotes?.some((n) => n.includes("nail-trim"))).toBe(true);
  });
});

describe("verifyDraft price evidence", () => {
  it("rejects a fabricated price appended after a verbatim evidence prefix", () => {
    const text = "Full groom small (under 10kg) $90 - $120 and lots of other words about the salon";
    const d = verifyDraft({ services: [
      { id: "full-groom", name: { en: "Full groom", zh: "全套" }, prices: [{ size: "small", min: 90, max: 120 }, { size: "medium", min: 500, max: 500 }], evidence: "Full groom small (under 10kg) $90 - $120 medium $500" },
    ], unsure: [] }, { source: { type: "website", fetchedAt: "" }, text });
    expect(d.partial.services).toBeUndefined();
  });
  it("does not let 12 pass as 120 or 120 pass as 1200", () => {
    const d = verifyDraft({ services: [
      { id: "a", name: { en: "A", zh: "A" }, prices: [{ size: "all", min: 12, max: 12 }], evidence: "Full groom $120" },
      { id: "b", name: { en: "B", zh: "B" }, prices: [{ size: "all", min: 120, max: 120 }], evidence: "Day care $1200" },
    ], unsure: [] }, { source: { type: "website", fetchedAt: "" }, text: "Full groom $120. Day care $1200" });
    expect(d.partial.services).toBeUndefined();
  });
  it("does not give invented opening hours full marks because a bare digit-colon appears on the page", () => {
    const allDays = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "09:00", close: "17:30" }]));
    const d = verifyDraft({ hours: allDays as Draft["hours"], unsure: [] }, { source: { type: "website", fetchedAt: "" }, text: "Open 9am - 5pm every day. Call 02 9555 1234 or 5:1 odds" });
    expect(d.confidence.hours).toBeLessThan(1);
    const ok = verifyDraft({ hours: allDays as Draft["hours"], unsure: [] }, { source: { type: "website", fetchedAt: "" }, text: "Open 9.00am - 5.30pm every day" });
    expect(ok.confidence.hours).toBe(1);
  });
  it("rejects a price whose digits only appear elsewhere on the page", () => {
    const text = "Call 02 9555 1234. Full groom $120";
    const d = verifyDraft({ services: [
      { id: "nail-trim", name: { en: "Nail trim", zh: "剪指甲" }, prices: [{ size: "all", min: 55, max: 55 }], evidence: "Full groom $120" },
      { id: "full-groom", name: { en: "Full groom", zh: "全套" }, prices: [{ size: "all", min: 120, max: 120 }], evidence: "Full groom $120" },
    ], unsure: [] }, { source: { type: "website", fetchedAt: "" }, text });
    expect(d.partial.services?.map((s) => s.id)).toEqual(["full-groom"]);
  });
  it("keeps image-sourced services even when evidence is only a label", () => {
    const d = verifyDraft({ services: [{ id: "style-cut", name: { en: "Style Cut", zh: "造型" }, durationMin: 45, prices: [{ size: "xs", min: 140, max: 140 }, { size: "s", min: 155, max: 155 }], evidence: "Style Cut" }], unsure: [] }, { source: { type: "instagram", fetchedAt: "" }, images: [{ data: "", mimeType: "image/png" }] });
    expect(d.partial.services).toHaveLength(1);
    expect(d.rawNotes?.some((n) => n.includes("read from images"))).toBe(true);
  });
  it("flags missing durations instead of silently defaulting", () => {
    const d = verifyDraft({ services: [{ id: "full-groom", name: { en: "Full groom", zh: "全套" }, prices: [{ size: "all", min: 120, max: 120 }], evidence: "Full groom $120" }], unsure: [] }, { source: { type: "website", fetchedAt: "" }, text: "Full groom $120" });
    // 占位时长是多少是调参，规则是：有占位就压低置信度并留话给美容师
    expect(d.partial.services?.[0]?.durationMin).toBeGreaterThan(0);
    expect(d.confidence.services).toBeLessThan(LOW_CONFIDENCE);
    expect(d.rawNotes?.some((n) => n.includes("duration not stated"))).toBe(true);
  });
});

describe("extractShopDraft", () => {
  it("retries on invalid tool args and succeeds on a valid call", async () => {
    const { faux, gateway } = fauxGateway();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("submit_shop_draft", { name: 123 })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Here is the draft: {...}")]),
      fauxAssistantMessage([fauxToolCall("submit_shop_draft", goodDraft)], { stopReason: "toolUse" }),
    ]);
    const d = await extractShopDraft(gateway, { source: { type: "website", fetchedAt: "" }, text: htmlToText(PRICING_HTML) + " Fluffy Paws Newtown 02 9555 1234" });
    expect(d.partial.name).toBe("Fluffy Paws Newtown");
    expect(faux.state.callCount).toBe(3);
    expect(d.rawNotes?.filter((n) => n.startsWith("attempt"))).toHaveLength(2);
  });
  it("answers every tool call in a message so the next request is valid", async () => {
    const { faux, gateway } = fauxGateway();
    let secondRequest: { messages: Array<{ role: string; toolName?: string }> } | undefined;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("submit_draft", { x: 1 }), fauxToolCall("submit_shop_draft", { name: 123 })], { stopReason: "toolUse" }),
      (context) => {
        secondRequest = context as never;
        return fauxAssistantMessage([fauxToolCall("submit_shop_draft", { name: "Ok", unsure: [] })], { stopReason: "toolUse" });
      },
    ]);
    const d = await extractShopDraft(gateway, { source: { type: "manual", fetchedAt: "" }, text: "Ok" });
    expect(d.partial.name).toBe("Ok");
    const results = secondRequest?.messages.filter((m) => m.role === "toolResult") ?? [];
    expect(results.map((m) => m.toolName).sort()).toEqual(["submit_draft", "submit_shop_draft"]);
  });
  it("gives up gracefully after repeated failures", async () => {
    const { faux, gateway } = fauxGateway();
    faux.setResponses([1, 2, 3].map(() => fauxAssistantMessage([fauxText("nope")])));
    const d = await extractShopDraft(gateway, { source: { type: "manual", fetchedAt: "" }, text: "x" });
    expect(d.partial).toEqual({});
    expect(d.rawNotes?.at(-1)).toMatch(/gave up/);
  });
});

describe("importWebsite", () => {
  it("matches interesting pages by path, not by domain, and follows redirects for link resolution", async () => {
    const { faux, gateway } = fauxGateway();
    const fetched: string[] = [];
    const fakeFetch = (async (url: string) => {
      fetched.push(url);
      // 裸域 301 到 www，之后页面里的绝对链接都指向 www
      if (url === "https://pawsgrooming.example/") return new Response(null, { status: 301, headers: { location: "https://www.pawsgrooming.example/" } });
      const html = url.includes("/pricing") ? PRICING_HTML : `<a href="https://www.pawsgrooming.example/gallery">g</a><a href="https://www.pawsgrooming.example/pricing">p</a>`;
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_shop_draft", { unsure: [] })], { stopReason: "toolUse" })]);
    await importWebsite(gateway, "https://pawsgrooming.example", { fetch: fakeFetch, lookup: publicLookup });
    expect(fetched).toEqual(["https://pawsgrooming.example/", "https://www.pawsgrooming.example/", "https://www.pawsgrooming.example/pricing"]);
  });
  it("caps each page separately so a bloated homepage cannot crowd out the pricing page", async () => {
    const { faux, gateway } = fauxGateway();
    let seenText = "";
    const fakeFetch = (async (url: string) => {
      const html = url.endsWith("/pricing") ? PRICING_HTML : `<a href="/pricing">p</a>` + "<p>nav</p>".repeat(3000);
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    faux.setResponses([(context) => {
      // 归一化后 messages[0] 是系统消息，找第一条 user
      const first = context.messages.find((m) => m.role === "user") as { content: Array<{ type: string; text?: string }> };
      seenText = first.content.map((c) => c.text ?? "").join("");
      return fauxAssistantMessage([fauxToolCall("submit_shop_draft", { unsure: [] })], { stopReason: "toolUse" });
    }]);
    await importWebsite(gateway, "https://big.example", { fetch: fakeFetch, lookup: publicLookup, maxChars: 4000 });
    expect(seenText).toContain("Full groom medium $120 - $160");
    expect(seenText).toContain("[truncated]");
  });
  it("fetches home plus interesting same-origin pages only", async () => {
    const { faux, gateway } = fauxGateway();
    const fetched: string[] = [];
    const fakeFetch = (async (url: string) => {
      fetched.push(url);
      const body = url.endsWith("/pricing") ? PRICING_HTML : SITE_HTML;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_shop_draft", goodDraft)], { stopReason: "toolUse" })]);
    const d = await importWebsite(gateway, "https://fluffypaws.example", { fetch: fakeFetch, lookup: publicLookup });
    expect(fetched).toEqual(["https://fluffypaws.example/", "https://fluffypaws.example/pricing"]);
    expect(d.partial.website).toBe("https://fluffypaws.example/");
    expect(d.partial.services?.[0]?.id).toBe("full-groom");
  });
});

describe("importWebsite boundaries", () => {
  it.each([
    ["network error", async () => { throw new Error("ETIMEDOUT"); }],
    ["404", async () => new Response("nope", { status: 404, headers: { "content-type": "text/html" } })],
    ["non-html", async () => new Response("%PDF-1.4", { status: 200, headers: { "content-type": "application/pdf" } })],
  ])("returns an empty draft with a note on %s instead of throwing", async (_label, impl) => {
    const { gateway } = fauxGateway();
    const d = await importWebsite(gateway, "https://down.example", { fetch: impl as unknown as typeof fetch, lookup: publicLookup });
    expect(d.partial).toEqual({});
    expect(d.rawNotes?.[0]).toMatch(/could not fetch/);
  });
});

describe("html helpers", () => {
  it("strips tags and keeps text lines", () => {
    const t = htmlToText(SITE_HTML);
    expect(t).toContain("Fluffy Paws Newtown");
    expect(t).not.toContain("<");
    expect(t).not.toContain(".x{}");
  });
  it("keeps same-origin links only", () => {
    expect(extractLinks(SITE_HTML, "https://fluffypaws.example")).toEqual(["https://fluffypaws.example/pricing", "https://fluffypaws.example/blog/post-1"]);
  });
  it("strips fragments instead of dropping fragment links, and skips mailto/tel", () => {
    const html = `<a href="/services#pricing">p</a><a href="mailto:a@b.c">m</a><a href="tel:123">t</a>`;
    expect(extractLinks(html, "https://x.example")).toEqual(["https://x.example/services"]);
  });
  it("survives out-of-range numeric entities and decodes hex ones", () => {
    expect(htmlToText("<p>a &#99999999; b &#x41;</p>")).toBe("a &#99999999; b A");
  });
});

describe("google", () => {
  it("maps Places periods to weekly hours, merging split shifts", () => {
    const h = mapHours([
      { open: { day: 2, hour: 9, minute: 0 }, close: { day: 2, hour: 12, minute: 30 } },
      { open: { day: 2, hour: 13, minute: 30 }, close: { day: 2, hour: 17, minute: 0 } },
      { open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 15, minute: 0 } },
    ]);
    expect(h.tue).toEqual({ open: "09:00", close: "17:00" });
    expect(h.sat).toEqual({ open: "09:00", close: "15:00" });
    expect(h.mon).toBeNull();
  });
  it("returns a note instead of throwing without an api key", async () => {
    const d = await importGoogleBusiness("x", { apiKey: undefined, fetch: (() => { throw new Error("should not fetch"); }) as never });
    expect(d.rawNotes?.[0]).toMatch(/GOOGLE_MAPS_API_KEY/);
  });
  it("returns a note instead of throwing on network failure", async () => {
    const d = await importGoogleBusiness("x", { apiKey: "k", fetch: (async () => { throw new Error("ECONNRESET"); }) as never });
    expect(d.rawNotes?.[0]).toMatch(/request failed: ECONNRESET/);
    expect(d.partial).toEqual({});
  });
  it("maps a places response", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ places: [{ id: "p1", displayName: { text: "Fluffy Paws" }, formattedAddress: "12 King St", nationalPhoneNumber: "02 9555 1234", websiteUri: "https://fluffypaws.example", regularOpeningHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }] } }] }), { status: 200 })) as unknown as typeof fetch;
    const d = await importGoogleBusiness("Fluffy Paws", { apiKey: "k", fetch: fakeFetch });
    expect(d.partial).toMatchObject({ name: "Fluffy Paws", phone: "02 9555 1234", website: "https://fluffypaws.example" });
    expect(d.partial.hours?.mon).toEqual({ open: "09:00", close: "17:00" });
    expect(d.confidence.hours).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });
});

describe("mergeDrafts", () => {
  it("takes the highest-confidence value per field and lists missing required fields", () => {
    const m = mergeDrafts([
      { source: { type: "website", fetchedAt: "" }, partial: { name: "Site Name", phone: "111" }, confidence: { name: 0.5, phone: 1 } },
      { source: { type: "google", fetchedAt: "" }, partial: { name: "Google Name", phone: "222" }, confidence: { name: 0.95, phone: 0.95 } },
    ], { slug: "x" });
    expect(m.partial.name).toBe("Google Name");
    expect(m.partial.phone).toBe("111");
    expect(m.missing).toEqual(["hours", "sizeTiers", "services", "policies"]);
    expect(m.sources).toHaveLength(2);
  });
  it("prefers tiered price lists over from-prices even at lower confidence", () => {
    const fromPrice = { id: "style-cut", name: { en: "Style cut", zh: "造型" }, durationMin: 60, prices: [{ size: "all", min: 140, max: 140 }] };
    const tiered = { id: "style-cut", name: { en: "Style cut", zh: "造型" }, durationMin: 45, prices: [{ size: "xs", min: 140, max: 140 }, { size: "s", min: 155, max: 155 }, { size: "m", min: 170, max: 170 }] };
    const m = mergeDrafts([
      { source: { type: "website", fetchedAt: "" }, partial: { services: [fromPrice], sizeTiers: [{ id: "all", label: { en: "All", zh: "全部" } }] }, confidence: { services: 1, sizeTiers: 0.7 } },
      { source: { type: "instagram", fetchedAt: "" }, partial: { services: [tiered], sizeTiers: [{ id: "xs", label: { en: "XS", zh: "超小" }, maxKg: 4 }, { id: "s", label: { en: "S", zh: "小" }, maxKg: 10 }, { id: "m", label: { en: "M", zh: "中" }, maxKg: 15 }] }, confidence: { services: 0.6, sizeTiers: 0.6 } },
    ]);
    expect(m.partial.services?.[0]?.prices).toHaveLength(3);
    expect(m.partial.sizeTiers).toHaveLength(3);
    expect(m.confidence.services).toBe(0.6);
  });
  it("merges services per id/name so services only one source lists survive", () => {
    const svc = (id: string, en: string, prices: Array<{ size: string; min: number; max: number }>) => ({ id, name: { en, zh: en }, durationMin: 60, prices });
    const merged = mergeServices(
      [svc("full-groom", "Full Groom", [{ size: "all", min: 120, max: 120 }]), svc("wash-and-tidy", "Wash & Tidy", [{ size: "all", min: 90, max: 90 }]), svc("nail-trim", "Nail trim", [{ size: "all", min: 20, max: 20 }])],
      [svc("full-grooming", "Full Grooming", [{ size: "s", min: 120, max: 120 }, { size: "m", min: 150, max: 150 }]), svc("wash-tidy", "Wash and Tidy", [{ size: "s", min: 90, max: 90 }, { size: "m", min: 115, max: 115 }])],
    );
    expect(merged.map((s) => s.id)).toEqual(["full-grooming", "wash-tidy", "nail-trim"]);
    expect(merged[0]?.prices).toHaveLength(2);
  });
  it("keeps operator-provided base values over scraped ones, even scraped ones with full confidence", () => {
    const m = mergeDrafts([{ source: { type: "website", fetchedAt: "" }, partial: { name: "Home | Fenny and Jacks" }, confidence: { name: 1 } }], { slug: "x", name: "Fenny & Jacks" });
    expect(m.partial.name).toBe("Fenny & Jacks");
  });
  it("lets a later source win an exact tie, including a tie at full confidence", () => {
    const m = mergeDrafts([
      { source: { type: "website", fetchedAt: "" }, partial: { phone: "111" }, confidence: { phone: 1 } },
      { source: { type: "google", fetchedAt: "" }, partial: { phone: "222" }, confidence: { phone: 1 } },
    ], { slug: "x" });
    expect(m.partial.phone).toBe("222");
  });
  it("does not satisfy policies with an empty disclaimer", () => {
    const d = verifyDraft({ notes: { en: "No cats", zh: "不接猫" }, unsure: [] }, { source: { type: "website", fetchedAt: "" }, text: "No cats" });
    expect(d.partial.policies?.quoteDisclaimer.en.length).toBeGreaterThan(0);
    expect(d.confidence.policies).toBeLessThan(LOW_CONFIDENCE);
  });
});
