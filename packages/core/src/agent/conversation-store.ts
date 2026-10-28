import type { Conversation } from "./loop.js";

/** 一个会话由店铺、渠道和渠道侧标识（网页 sessionId、Instagram thread、WhatsApp 号码）唯一确定 */
export interface ConversationKey {
  shopSlug: string;
  channel: string;
  externalId: string;
}

/**
 * 会话存储。一轮 = findOrCreate → runTurn（原地改 messages 和 images）→ save。
 * 调用方要保证同一个 key 的轮次串行，否则后保存的会盖掉先保存的。
 */
export interface ConversationStore {
  /** 按 key 找，没有就建。locale 只在新建时生效 */
  findOrCreate(key: ConversationKey, locale: "en" | "zh"): Promise<Conversation>;
  /** 一轮跑完后持久化 messages 和这轮新收的图片 */
  save(conv: Conversation): Promise<void>;
  /** 美容师端按 id 看一个会话。调用方要自己核对 shopSlug，这里不认店 */
  get(id: string): Promise<Conversation | undefined>;
}

export function conversationKey(k: ConversationKey): string {
  return `${k.shopSlug}:${k.channel}:${k.externalId}`;
}
