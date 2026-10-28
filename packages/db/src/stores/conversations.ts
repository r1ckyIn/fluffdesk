import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { pruneOldImages, type Conversation, type ConversationKey, type ConversationStore } from "@fluffdesk/core";
import type { Db } from "../client.js";
import { conversationImages, conversations } from "../schema.js";

export class PgConversationStore implements ConversationStore {
  /** 每个加载出来的会话已经落库的图片 id：save 只插新图，不每轮重发所有 base64 */
  private readonly persistedImages = new WeakMap<Conversation, Set<string>>();

  constructor(
    private readonly db: Db,
    private readonly newId: () => string = () => `cv_${randomUUID()}`,
  ) {}

  async findOrCreate(key: ConversationKey, locale: "en" | "zh"): Promise<Conversation> {
    const found = await this.load(key);
    if (found) return found;
    // 两条首消息同时到：唯一索引保证只插进去一条，谁插的都一样，再读一次拿同一条
    await this.db
      .insert(conversations)
      .values({ id: this.newId(), shopSlug: key.shopSlug, channel: key.channel, externalId: key.externalId, locale })
      .onConflictDoNothing();
    const conv = await this.load(key);
    if (!conv) throw new Error("conversation missing right after insert");
    return conv;
  }

  async save(conv: Conversation): Promise<void> {
    const known = this.persistedImages.get(conv) ?? new Set<string>();
    const fresh = [...conv.images]
      .filter(([id]) => !known.has(id))
      .map(([id, img]) => ({ conversationId: conv.id, imageId: id, mimeType: img.mimeType, data: img.data }));
    await this.db.transaction(async (tx) => {
      if (fresh.length > 0) await tx.insert(conversationImages).values(fresh).onConflictDoNothing();
      await tx.update(conversations).set({ messages: conv.messages, updatedAt: new Date() }).where(eq(conversations.id, conv.id));
    });
    for (const f of fresh) known.add(f.imageId);
    this.persistedImages.set(conv, known);
  }

  /**
   * 清掉闲置会话的图片：images 表的行删掉，messages 里还内嵌的图换成占位文字。
   * 文字历史保留。一次最多处理 100 个会话，返回处理了几个。
   */
  async expireIdleImages(idleBefore: Date, batch = 100): Promise<number> {
    const stale = await this.db
      .select({ id: conversations.id, messages: conversations.messages })
      .from(conversations)
      .where(
        and(
          lt(conversations.updatedAt, idleBefore),
          sql`(exists (select 1 from ${conversationImages} ci where ci.conversation_id = ${conversations.id})
               or ${conversations.messages} @> '[{"content":[{"type":"image"}]}]'::jsonb)`,
        ),
      )
      .limit(batch);
    if (stale.length === 0) return 0;
    await this.db.transaction(async (tx) => {
      await tx.delete(conversationImages).where(inArray(conversationImages.conversationId, stale.map((c) => c.id)));
      for (const c of stale) {
        pruneOldImages(c.messages, 0);
        // 不动 updated_at：这不是客人的活动
        await tx.update(conversations).set({ messages: c.messages }).where(eq(conversations.id, c.id));
      }
    });
    return stale.length;
  }

  private async load(key: ConversationKey): Promise<Conversation | undefined> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.shopSlug, key.shopSlug), eq(conversations.channel, key.channel), eq(conversations.externalId, key.externalId)))
      .limit(1);
    if (!row) return undefined;
    const imgs = await this.db
      .select({ imageId: conversationImages.imageId, mimeType: conversationImages.mimeType, data: conversationImages.data })
      .from(conversationImages)
      .where(eq(conversationImages.conversationId, row.id));
    const conv: Conversation = {
      id: row.id,
      shopSlug: row.shopSlug,
      channel: row.channel,
      locale: row.locale,
      messages: row.messages,
      images: new Map(imgs.map((i) => [i.imageId, { data: i.data, mimeType: i.mimeType }])),
    };
    this.persistedImages.set(conv, new Set(imgs.map((i) => i.imageId)));
    return conv;
  }
}
