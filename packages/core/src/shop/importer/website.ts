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
  // 跳转后的最终地址才是真正的站点（http→https、裸域→www），链接按它解析
  const homeUrl = home.url;
  pages.push({ url: homeUrl, text: htmlToText(home.html) });

  const seen = new Set([homeUrl.replace(/\/$/, "")]);
  const links = extractLinks(home.html, homeUrl)
    .filter((l) => !seen.has(l) && INTERESTING.test(new URL(l).pathname))
    .slice(0, maxPages - 1);
  for (const link of links) {
    const page = await fetchPage(fetchImpl, link);
    if (page && !seen.has(page.url.replace(/\/$/, ""))) {
      seen.add(page.url.replace(/\/$/, ""));
      pages.push({ url: page.url, text: htmlToText(page.html) });
    }
  }

  let text = pages.map((p) => `=== ${p.url} ===\n${p.text}`).join("\n\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n[truncated]";

  const draft = await extractShopDraft(gateway, { source, text, hints: {} });
  draft.partial.website = url;
  draft.rawNotes = [`fetched ${pages.length} page(s): ${pages.map((p) => p.url).join(", ")}`, ...(draft.rawNotes ?? [])];
  return draft;
}

async function fetchPage(fetchImpl: typeof globalThis.fetch, url: string): Promise<{ html: string; url: string } | undefined> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "fluffdesk-importer/0.1 (+https://github.com/r1ckyIn/fluffdesk)", accept: "text/html" }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return undefined;
    return { html: await res.text(), url: res.url || url };
  } catch {
    return undefined;
  }
}
