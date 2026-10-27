import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createGateway } from "../src/llm/gateway.js";
import { extractShopDraft, verifyDraft, type Draft } from "../src/shop/importer/extract.js";
import { importWebsite } from "../src/shop/importer/website.js";
import { importGoogleBusiness, mapHours } from "../src/shop/importer/google.js";
import { mergeDrafts } from "../src/shop/importer/index.js";
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
    { id: "full-groom", name: { en: "Full groom", zh: "全套美容" }, prices: [{ size: "small", min: 90, max: 120 }, { size: "medium", min: 120, max: 160 }], evidence: "Full groom small (under 10kg) $90 - $120" },
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
    expect(d.confidence.hours).toBe(1);
    expect(d.rawNotes?.some((n) => n.includes("nail-trim"))).toBe(true);
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
  it("gives up gracefully after repeated failures", async () => {
    const { faux, gateway } = fauxGateway();
    faux.setResponses([1, 2, 3].map(() => fauxAssistantMessage([fauxText("nope")])));
    const d = await extractShopDraft(gateway, { source: { type: "manual", fetchedAt: "" }, text: "x" });
    expect(d.partial).toEqual({});
    expect(d.rawNotes?.at(-1)).toMatch(/gave up/);
  });
});

describe("importWebsite", () => {
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
});
