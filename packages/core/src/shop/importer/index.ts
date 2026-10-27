import type { ShopConfig, ShopSource } from "../schema.js";

/**
 * 从公开信息生成店铺配置草稿。每个来源一个导入器，产出的是部分配置加置信度，
 * 由 mergeDrafts 合并，美容师在后台确认后才成为正式配置。
 * 这是销售第一段（免费 demo）的入口：半小时内从公开信息做出能用的聊天页。
 */
export interface ShopDraft {
  source: ShopSource;
  partial: Partial<ShopConfig>;
  /** 导入器对每个字段的把握，低于阈值的字段在后台标红让美容师看 */
  confidence: Partial<Record<keyof ShopConfig, number>>;
  rawNotes?: string[];
}

export interface ShopImporter {
  readonly type: ShopSource["type"];
  canHandle(url: string): boolean;
  import(url: string): Promise<ShopDraft>;
}

export function mergeDrafts(base: Partial<ShopConfig>, drafts: ShopDraft[]): Partial<ShopConfig> {
  let out: Partial<ShopConfig> = { ...base, sources: [...(base.sources ?? [])] };
  for (const d of drafts) {
    out = { ...out, ...d.partial, sources: [...(out.sources ?? []), d.source] };
  }
  return out;
}

export { instagramImporter } from "./instagram.js";
export { googleBusinessImporter } from "./google.js";
export { websiteImporter } from "./website.js";
