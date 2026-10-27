import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ShopConfig, Trace, Correction, PetSummary } from "@fluffdesk/core";

/** 店铺：配置整份存 jsonb，schema 在 core 里校验，这里不拆列 */
export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  config: jsonb("config").$type<ShopConfig>().notNull(),
  /** 美容师确认过的配置才会设为 true；导入器生成的草稿是 false */
  approved: boolean("approved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groomers = pgTable("groomers", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  locale: text("locale").notNull().default("en"),
  pushSubscription: jsonb("push_subscription"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => shops.id),
    channel: text("channel").notNull(),
    /** 渠道侧的会话标识：Instagram thread id、WhatsApp 号码、网页 session */
    externalId: text("external_id"),
    locale: text("locale").notNull().default("en"),
    /** pi-ai 的 Message[]，整份存，重放和 eval 都靠它 */
    messages: jsonb("messages").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_shop_channel_ext").on(t.shopId, t.channel, t.externalId)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => shops.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    status: text("status").notNull().default("pending"),
    customerName: text("customer_name").notNull(),
    customerContact: text("customer_contact").notNull(),
    channel: text("channel").notNull(),
    pet: jsonb("pet").$type<PetSummary>().notNull(),
    serviceId: text("service_id").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    quoteMin: numeric("quote_min"),
    quoteMax: numeric("quote_max"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => groomers.id),
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bookings_shop_status").on(t.shopId, t.status)],
);

export const traces = pgTable("traces", {
  id: text("id").primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  shopId: uuid("shop_id").references(() => shops.id),
  trace: jsonb("trace").$type<Trace>().notNull(),
  costUsd: numeric("cost_usd").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 美容师的修正，eval 集的来源 */
export const corrections = pgTable("corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id),
  conversationId: uuid("conversation_id").references(() => conversations.id),
  traceId: text("trace_id"),
  kind: text("kind").$type<Correction["kind"]>().notNull(),
  original: jsonb("original").notNull(),
  corrected: jsonb("corrected").notNull(),
  note: text("note"),
  by: uuid("by").references(() => groomers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
