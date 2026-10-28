import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Booking, BookingStatus, Conversation, Correction, PetSummary, ShopConfig, Trace } from "@fluffdesk/core";

/**
 * 所有 id 都是应用生成的带前缀文本（cv_/bk_/tr_/cor_），和领域类型一致，
 * 内存实现和 Postgres 实现的行为才能一样。时间戳列是 timestamptz，读出来转 ISO 字符串。
 */

/** 店铺：slug 就是主键，配置整份存 jsonb，schema 在 core 里校验，这里不拆列 */
export const shops = pgTable("shops", {
  slug: text("slug").primaryKey(),
  config: jsonb("config").$type<ShopConfig>().notNull(),
  /** 美容师确认过的配置才会设为 true；导入器生成的草稿是 false，agent 看不到 */
  approved: boolean("approved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    shopSlug: text("shop_slug").notNull().references(() => shops.slug),
    channel: text("channel").notNull(),
    /** 渠道侧的会话标识：Instagram thread id、WhatsApp 号码、网页 sessionId */
    externalId: text("external_id").notNull(),
    locale: text("locale").$type<"en" | "zh">().notNull().default("en"),
    /** pi-ai 的 Message[]，整份存，重放和 eval 都靠它。老图片已被循环换成文字占位，所以不会无限长大 */
    messages: jsonb("messages").$type<Conversation["messages"]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conversations_shop_channel_ext").on(t.shopSlug, t.channel, t.externalId)],
);

/** 客人发的图单独一张表，只追加。放在会话行里的话每轮都要重写十几 MB 的 jsonb */
export const conversationImages = pgTable(
  "conversation_images",
  {
    conversationId: text("conversation_id").notNull().references(() => conversations.id),
    imageId: text("image_id").notNull(),
    mimeType: text("mime_type").notNull(),
    /** base64 */
    data: text("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.imageId] })],
);

export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    shopSlug: text("shop_slug").notNull().references(() => shops.slug),
    conversationId: text("conversation_id").notNull().references(() => conversations.id),
    status: text("status").$type<BookingStatus>().notNull().default("pending"),
    customerName: text("customer_name").notNull(),
    customerContact: text("customer_contact").notNull(),
    channel: text("channel").notNull(),
    pet: jsonb("pet").$type<PetSummary>().notNull(),
    serviceId: text("service_id").notNull(),
    /** 店铺时区的本地时间，YYYY-MM-DDTHH:MM，和工具参数一字不差；不转 UTC 免得时区转错把预约挪一天 */
    start: text("start").notNull(),
    durationMin: integer("duration_min").notNull(),
    quote: jsonb("quote").$type<NonNullable<Booking["quote"]>>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bookings_shop_status").on(t.shopSlug, t.status), index("bookings_conversation_status").on(t.conversationId, t.status)],
);

export const traces = pgTable("traces", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  shopSlug: text("shop_slug").references(() => shops.slug),
  trace: jsonb("trace").$type<Trace>().notNull(),
  costUsd: numeric("cost_usd").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 美容师的修正，eval 集的来源。conversationId 来自美容师端提交，不做外键，免得错 id 变成 500 */
export const corrections = pgTable("corrections", {
  id: text("id").primaryKey(),
  shopSlug: text("shop_slug").notNull().references(() => shops.slug),
  conversationId: text("conversation_id").notNull(),
  traceId: text("trace_id"),
  kind: text("kind").$type<Correction["kind"]>().notNull(),
  original: jsonb("original"),
  corrected: jsonb("corrected"),
  note: text("note"),
  correctedBy: text("corrected_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
