import type { Gateway } from "../../llm/gateway.js";
import { extractShopDraft } from "./extract.js";
import { extractLinks, htmlToText } from "./html.js";
import type { ShopDraft } from "./index.js";

/**
 * 官网导入：抓首页，再抓看起来像价格/服务/联系的同域页面，合成一份文本交给抽取器。
 * fetch 可注入，测试不走网络。
 */
export interface WebsiteImportOptions {
  fetch?: typeof globalThis.fetch;
  maxPages?: number;
  maxChars?: number;
}

const INTERESTING = /price|pricing|service|menu|rate|about|contact|book|groom|package/i;

export async function importWebsite(gateway: Gateway, url: string, opts: WebsiteImportOptions = {}): Promise<ShopDraft> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const maxPages = opts.maxPages ?? 6;
  const maxChars = opts.maxChars ?? 40_000;
  const fetchedAt = new Date().toISOString();
  const source = { type: "website" as const, url, fetchedAt };

  const pages: Array<{ url: string; text: string }> = [];
  const home = await fetchPage(fetchImpl, url);
  if (!home) return { source, partial: {}, confidence: {}, rawNotes: [`could not fetch ${url}`] };
  pages.push({ url, text: htmlToText(home) });

  const links = extractLinks(home, url).filter((l) => l !== url.replace(/\/$/, "") && INTERESTING.test(l)).slice(0, maxPages - 1);
  for (const link of links) {
    const html = await fetchPage(fetchImpl, link);
    if (html) pages.push({ url: link, text: htmlToText(html) });
  }

  let text = pages.map((p) => `=== ${p.url} ===\n${p.text}`).join("\n\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n[truncated]";

  const draft = await extractShopDraft(gateway, { source, text, hints: {} });
  draft.partial.website = url;
  draft.rawNotes = [`fetched ${pages.length} page(s): ${pages.map((p) => p.url).join(", ")}`, ...(draft.rawNotes ?? [])];
  return draft;
}

async function fetchPage(fetchImpl: typeof globalThis.fetch, url: string): Promise<string | undefined> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "fluffdesk-importer/0.1 (+https://github.com/r1ckyIn/fluffdesk)", accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return undefined;
    return await res.text();
  } catch {
    return undefined;
  }
}
