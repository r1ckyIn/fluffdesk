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

/** 每个字段取置信度最高的来源；平手后来的赢。sources 和 notes 全保留 */
export function mergeDrafts(drafts: ShopDraft[], base: Partial<ShopConfig> = {}): MergedDraft {
  const partial: Partial<ShopConfig> = { ...base };
  const confidence: ShopDraft["confidence"] = {};
  const notes: string[] = [];
  for (const d of drafts) {
    for (const key of Object.keys(d.partial) as Array<keyof ShopConfig>) {
      const c = d.confidence[key] ?? 0.5;
      if (partial[key] === undefined || c >= (confidence[key] ?? -1)) {
        (partial as Record<string, unknown>)[key] = d.partial[key];
        confidence[key] = c;
      }
    }
    for (const n of d.rawNotes ?? []) notes.push(`[${d.source.type}] ${n}`);
  }
  const sources = drafts.map((d) => d.source);
  const missing = REQUIRED.filter((k) => partial[k] === undefined);
  return { partial: { ...partial, sources }, confidence, sources, notes, missing };
}

export { extractShopDraft, verifyDraft, DraftSchema, submitDraftTool, type Draft, type ExtractInput } from "./extract.js";
export { importWebsite } from "./website.js";
export { importScreenshots } from "./screenshots.js";
export { importGoogleBusiness, mapHours } from "./google.js";
export { htmlToText, extractLinks } from "./html.js";
