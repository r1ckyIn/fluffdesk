import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createGateway } from "../src/llm/gateway.js";
import { extractShopDraft, verifyDraft, type Draft } from "../src/shop/importer/extract.js";
import { importWebsite } from "../src/shop/importer/website.js";
import { importGoogleBusiness, mapHours } from "../src/shop/importer/google.js";
import { mergeDrafts, mergeServices } from "../src/shop/importer/index.js";
import { htmlToText, extractLinks } from "../src/shop/importer/html.js";

function fauxGateway() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  return { faux, gateway: createGateway({ models, roleModels: { chat: m, vision: m, judge: m, fallback: m } }) };
}

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
    expect(d.confidence.services).toBe(0.5);
    expect(d.confidence.phone).toBe(1);
    expect(d.confidence.hours).toBeCloseTo(2 / 7);
    expect(d.rawNotes?.some((n) => n.includes("nail-trim"))).toBe(true);
  });
});

describe("verifyDraft price evidence", () => {
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
    expect(d.partial.services?.[0]?.durationMin).toBe(60);
    expect(d.confidence.services).toBe(0.7);
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
      const finalUrl = url.replace("https://pawsgrooming.example", "https://www.pawsgrooming.example");
      const html = url.includes("/pricing") ? PRICING_HTML : `<a href="https://www.pawsgrooming.example/gallery">g</a><a href="https://www.pawsgrooming.example/pricing">p</a>`;
      // Response.url 是只读 getter，手工造一个带 url 的响应对象
      return { ok: true, url: finalUrl, headers: new Headers({ "content-type": "text/html" }), text: async () => html } as unknown as Response;
    }) as unknown as typeof fetch;
    faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_shop_draft", { unsure: [] })], { stopReason: "toolUse" })]);
    await importWebsite(gateway, "https://pawsgrooming.example", { fetch: fakeFetch });
    expect(fetched).toEqual(["https://pawsgrooming.example", "https://www.pawsgrooming.example/pricing"]);
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
    await importWebsite(gateway, "https://big.example", { fetch: fakeFetch, maxChars: 4000 });
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
    const d = await importWebsite(gateway, "https://fluffypaws.example", { fetch: fakeFetch });
    expect(fetched).toEqual(["https://fluffypaws.example", "https://fluffypaws.example/pricing"]);
    expect(d.partial.website).toBe("https://fluffypaws.example");
    expect(d.partial.services?.[0]?.id).toBe("full-groom");
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
    expect(d.confidence.hours).toBe(0.9);
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
  it("keeps operator-provided base values over scraped ones", () => {
    const m = mergeDrafts([{ source: { type: "website", fetchedAt: "" }, partial: { name: "Home | Fenny and Jacks" }, confidence: { name: 0.5 } }], { slug: "x", name: "Fenny & Jacks" });
    expect(m.partial.name).toBe("Fenny & Jacks");
  });
  it("does not satisfy policies with an empty disclaimer", () => {
    const d = verifyDraft({ notes: { en: "No cats", zh: "不接猫" }, unsure: [] }, { source: { type: "website", fetchedAt: "" }, text: "No cats" });
    expect(d.partial.policies?.quoteDisclaimer.en.length).toBeGreaterThan(0);
    expect(d.confidence.policies).toBe(0.5);
  });
});
