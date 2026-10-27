/**
 * 美容师的修正记录。每条都是一条未来的 eval 用例：
 * 同样的输入，期望输出改成美容师给的。
 */
export type CorrectionKind = "pet_identification" | "quote" | "reply";

export interface Correction {
  id: string;
  shopSlug: string;
  conversationId: string;
  traceId?: string;
  kind: CorrectionKind;
  /** agent 原来给的 */
  original: unknown;
  /** 美容师改成的 */
  corrected: unknown;
  note?: string;
  by: string;
  createdAt: string;
}
