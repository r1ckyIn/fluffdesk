import type { Gateway } from "../../llm/gateway.js";
import { extractShopDraft } from "./extract.js";
import type { ShopDraft } from "./index.js";

/**
 * 截图模式：Instagram 简介、价目表帖子、Google 商家页的截图直接喂给模型。
 * demo 阶段的 Instagram 来源就是它；Graph API 接上后再加自动同步。
 * 图片来源没法逐字核对，所以置信度上限压到 0.6，字段都要人看一眼。
 */
export async function importScreenshots(
  gateway: Gateway,
  images: Array<{ data: string; mimeType: string }>,
  opts: { origin?: "instagram" | "google" | "manual"; url?: string; name?: string; pastedText?: string } = {},
): Promise<ShopDraft> {
  const source = { type: opts.origin ?? "manual", url: opts.url, fetchedAt: new Date().toISOString() } as const;
  const draft = await extractShopDraft(gateway, { source, images, text: opts.pastedText, hints: { name: opts.name } });
  for (const k of Object.keys(draft.confidence) as Array<keyof typeof draft.confidence>) {
    draft.confidence[k] = Math.min(draft.confidence[k] ?? 0, 0.6);
  }
  return draft;
}
