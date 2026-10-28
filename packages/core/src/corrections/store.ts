import type { Correction } from "./types.js";

/** 修正记录的存储。只追加；导出 eval 集时按店读 */
export interface CorrectionStore {
  add(correction: Correction): Promise<void>;
  list(shopSlug: string): Promise<Correction[]>;
}
