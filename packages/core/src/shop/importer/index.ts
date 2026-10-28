import type { ShopConfig, ShopSource } from "../schema.js";

/**
 * 从公开信息生成店铺配置草稿。每个来源一个导入器，产出部分配置加每个字段的置信度，
 * mergeDrafts 按置信度合并，美容师在后台确认后才成为正式配置。
 * 这是销售第一段（免费 demo）的入口：半小时内从公开信息做出能用的聊天页。
 */
export interface ShopDraft {
  source: ShopSource;
  partial: Partial<ShopConfig>;
  /** 0-1，低于 LOW_CONFIDENCE 的字段在后台标红让美容师看 */
  confidence: Partial<Record<keyof ShopConfig, number>>;
  rawNotes?: string[];
}

export const LOW_CONFIDENCE = 0.8;

export interface MergedDraft {
  partial: Partial<ShopConfig>;
  confidence: ShopDraft["confidence"];
  sources: ShopSource[];
  notes: string[];
  /** 还缺的必填字段，demo 前要人补 */
  missing: Array<keyof ShopConfig>;
}

const REQUIRED: Array<keyof ShopConfig> = ["slug", "name", "hours", "sizeTiers", "services", "policies"];

function serviceRichness(s: ShopConfig["services"][number]): number {
  const sizes = new Set(s.prices.map((p) => p.size));
  return sizes.size * 10 + s.prices.filter((p) => p.max > p.min).length;
}

/** 不同来源给的 id 不一致（full-groom / full-grooming），按 id 或英文名归一后匹配 */
export function serviceKeys(s: ShopConfig["services"][number]): string[] {
  return [...new Set([canon(s.id), canon(s.name.en)])];
}
function canon(v: string): string {
  return v.toLowerCase().replace(/&/g, "and").replace(/grooming/g, "groom").replace(/\band\b/g, "").replace(/[^a-z0-9]/g, "");
}

export function mergeServices(a: ShopConfig["services"], b: ShopConfig["services"]): ShopConfig["services"] {
  const out = [...a];
  for (const s of b) {
    const keys = serviceKeys(s);
    const idx = out.findIndex((cur) => serviceKeys(cur).some((k) => keys.includes(k)));
    if (idx === -1) out.push(s);
    else if (serviceRichness(s) > serviceRichness(out[idx]!)) out[idx] = s;
  }
  return out;
}

/** 只有 services 和 sizeTiers 比信息量，其他字段一律 0，退回比置信度 */
export function richnessOf(key: keyof ShopConfig, value: unknown): number {
  if (key === "services" && Array.isArray(value)) {
    const services = value as ShopConfig["services"];
    return services.reduce((sum, s) => sum + serviceRichness(s), 0) + services.length * 0.1;
  }
  if (key === "sizeTiers" && Array.isArray(value)) {
    const tiers = value as ShopConfig["sizeTiers"];
    return tiers.length * 10 + tiers.filter((t) => t.maxKg !== undefined).length;
  }
  return 0;
}

/**
 * 合并规则：
 * - services / sizeTiers 先比"信息量"：按体型分档、有区间的价目表胜过一个起步价。
 *   官网常常只写 from $140，Instagram 价目帖反而是完整的分档表，不能让置信度把它压掉
 * - 其他字段取置信度最高的来源；平手后来的赢
 * sources 和 notes 全保留
 */
export function mergeDrafts(drafts: ShopDraft[], base: Partial<ShopConfig> = {}): MergedDraft {
  const partial: Partial<ShopConfig> = { ...base };
  const confidence: ShopDraft["confidence"] = {};
  const richness: Partial<Record<keyof ShopConfig, number>> = {};
  const notes: string[] = [];
  // 人工给的 base 字段锁定：只有信息量更高的来源才能覆盖（实际上只有 services/sizeTiers 可能）。
  // 锁是显式的，不靠"置信度等于 1"表达：抓到的字段也可能满分，满分平手照样是后来的赢
  const locked = new Set<keyof ShopConfig>();
  for (const key of Object.keys(base) as Array<keyof ShopConfig>) {
    if (base[key] === undefined) continue;
    locked.add(key);
    confidence[key] = 1;
    richness[key] = richnessOf(key, base[key]);
  }
  for (const d of drafts) {
    for (const key of Object.keys(d.partial) as Array<keyof ShopConfig>) {
      const c = d.confidence[key] ?? 0.5;
      if (key === "services" && partial.services && d.partial.services) {
        // 服务按 id 合并：每个 id 取更丰富的价目，只在一边出现的保留
        partial.services = mergeServices(partial.services, d.partial.services);
        confidence.services = Math.min(confidence.services ?? 1, c);
        richness.services = richnessOf("services", partial.services);
        continue;
      }
      const r = richnessOf(key, d.partial[key]);
      const better = partial[key] === undefined || r > (richness[key] ?? -1) || (r === (richness[key] ?? -1) && c >= (confidence[key] ?? -1) && !locked.has(key));
      if (better) {
        (partial as Record<string, unknown>)[key] = d.partial[key];
        confidence[key] = c;
        richness[key] = r;
      }
    }
    for (const n of d.rawNotes ?? []) notes.push(`[${d.source.type}] ${n}`);
  }
  const sources = drafts.map((d) => d.source);
  const missing = REQUIRED.filter((k) => partial[k] === undefined);
  return { partial: { ...partial, sources }, confidence, sources, notes, missing };
}

export { extractShopDraft, verifyDraft, DraftSchema, submitDraftTool, DEFAULT_QUOTE_DISCLAIMER, type Draft, type ExtractInput } from "./extract.js";
export { importWebsite } from "./website.js";
export { importScreenshots } from "./screenshots.js";
export { importGoogleBusiness, mapHours } from "./google.js";
export { htmlToText, extractLinks } from "./html.js";
export { safeFetchHtml, isPrivateAddress, UnsafeUrlError } from "./safe-fetch.js";
