import { conversationKey, newConversation, type Conversation, type ConversationKey, type ConversationStore, type Correction, type CorrectionStore } from "@fluffdesk/core";
import { BoundedStore } from "./ratelimit.js";

/**
 * 没配 DATABASE_URL 时的内存实现：本地开发、测试、Docker 冒烟用，重启全丢。
 * 行为和 @fluffdesk/db 的实现一致，只是容量有上限，因为公网来的 key 不能无限收。
 */
export class MemoryConversationStore implements ConversationStore {
  constructor(private readonly store = new BoundedStore<Conversation>(5000, 24 * 60 * 60 * 1000)) {}

  async findOrCreate(key: ConversationKey, locale: "en" | "zh"): Promise<Conversation> {
    const k = conversationKey(key);
    let conv = this.store.get(k);
    if (!conv) {
      conv = newConversation({ id: k, shopSlug: key.shopSlug, channel: key.channel, locale });
      this.store.set(k, conv);
    }
    return conv;
  }

  /** 拿到的就是存着的那个对象，save 只是刷新它的活跃时间 */
  async save(conv: Conversation): Promise<void> {
    this.store.set(conv.id, conv);
  }
}

export class MemoryCorrectionStore implements CorrectionStore {
  private readonly items: Correction[] = [];
  constructor(private readonly max = 5000) {}

  async add(c: Correction): Promise<void> {
    this.items.push(c);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }
  async list(shopSlug: string): Promise<Correction[]> {
    return this.items.filter((c) => c.shopSlug === shopSlug);
  }
}
