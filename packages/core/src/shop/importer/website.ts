import type { Gateway } from "../../llm/gateway.js";
import { extractShopDraft } from "./extract.js";
import { extractLinks, htmlToText } from "./html.js";
import type { ShopDraft } from "./index.js";
import { safeFetchHtml, type SafeFetchOptions } from "./safe-fetch.js";

/**
 * 官网导入：抓首页，再抓看起来像价格/服务/联系的同域页面，合成一份文本交给抽取器。
 * fetch 可注入，测试不走网络。
 */
export interface WebsiteImportOptions extends Pick<SafeFetchOptions, "fetch" | "lookup" | "maxBytes"> {
  maxPages?: number;
  maxChars?: number;
}

const INTERESTING = /price|pricing|service|menu|rate|about|contact|book|groom|package/i;

export async function importWebsite(gateway: Gateway, url: string, opts: WebsiteImportOptions = {}): Promise<ShopDraft> {
  const fetchOpts: SafeFetchOptions = { fetch: opts.fetch, lookup: opts.lookup, maxBytes: opts.maxBytes };
  const maxPages = opts.maxPages ?? 6;
  const maxChars = opts.maxChars ?? 40_000;
  const fetchedAt = new Date().toISOString();
  const source = { type: "website" as const, url, fetchedAt };

  const pages: Array<{ url: string; text: string }> = [];
  const home = await fetchPage(url, fetchOpts);
  if (!home.page) return { source, partial: {}, confidence: {}, rawNotes: [`could not fetch ${url}: ${home.reason}`] };
  // 跳转后的最终地址才是真正的站点（http→https、裸域→www），链接按它解析
  const homeUrl = home.page.url;
  pages.push({ url: homeUrl, text: htmlToText(home.page.html) });

  const seen = new Set([homeUrl.replace(/\/$/, "")]);
  const links = extractLinks(home.page.html, homeUrl)
    .filter((l) => !seen.has(l) && INTERESTING.test(new URL(l).pathname))
    .slice(0, maxPages - 1);
  // 子页并行抓，慢站点不用一页页等 15 秒
  const fetched = await Promise.all(links.map((link) => fetchPage(link, fetchOpts)));
  for (const { page } of fetched) {
    if (page && !seen.has(page.url.replace(/\/$/, ""))) {
      seen.add(page.url.replace(/\/$/, ""));
      pages.push({ url: page.url, text: htmlToText(page.html) });
    }
  }

  // 每页单独限长，首页的导航页脚不能把价格页挤掉
  const perPage = Math.floor(maxChars / pages.length);
  const text = pages
    .map((p) => `=== ${p.url} ===\n${p.text.length > perPage ? p.text.slice(0, perPage) + "\n[truncated]" : p.text}`)
    .join("\n\n");

  const draft = await extractShopDraft(gateway, { source, text, hints: {} });
  draft.partial.website = homeUrl;
  draft.confidence.website = 1;
  draft.rawNotes = [`fetched ${pages.length} page(s): ${pages.map((p) => p.url).join(", ")}`, ...(draft.rawNotes ?? [])];
  return draft;
}

async function fetchPage(url: string, opts: SafeFetchOptions): Promise<{ page?: { html: string; url: string }; reason?: string }> {
  try {
    return { page: await safeFetchHtml(url, opts) };
  } catch (e) {
    // 不安全的地址、超时、非 HTML 都在这里吞掉，返回原因给草稿说明
    return { reason: (e as Error).message };
  }
}
