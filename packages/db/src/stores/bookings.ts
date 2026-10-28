import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { BookingStateError, type Booking, type BookingStore } from "@fluffdesk/core";
import type { Db } from "../client.js";
import { bookings } from "../schema.js";

type Row = typeof bookings.$inferSelect;

/** 预约存储的 Postgres 实现。状态机的落点在 decide：条件写在 SQL 里，两个人同时点只有一个成功 */
export class PgBookingStore implements BookingStore {
  constructor(
    private readonly db: Db,
    private readonly newId: () => string = () => `bk_${randomUUID()}`,
  ) {}

  /** 同会话、同服务、同时段撞上部分唯一索引就回已有的那条，两个实例同时插也只会有一条 */
  async createPending(input: Omit<Booking, "id" | "status" | "createdAt">): Promise<Booking> {
    const [row] = await this.db
      .insert(bookings)
      .values({ id: this.newId(), status: "pending", ...toColumns(input) })
      .onConflictDoNothing({ target: [bookings.conversationId, bookings.serviceId, bookings.start], where: sql`${bookings.status} = 'pending'` })
      .returning();
    if (row) return toBooking(row);
    const [existing] = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.conversationId, input.conversationId), eq(bookings.serviceId, input.serviceId), eq(bookings.start, input.start), eq(bookings.status, "pending")))
      .limit(1);
    if (!existing) throw new Error("pending booking missing right after conflict");
    return toBooking(existing);
  }

  async updatePending(id: string, input: Omit<Booking, "id" | "status" | "createdAt">): Promise<Booking> {
    const [row] = await this.db
      .update(bookings)
      .set(toColumns(input))
      // 带上会话 id：拿着外来 id 也改不到别的会话的预约
      .where(and(eq(bookings.id, id), eq(bookings.conversationId, input.conversationId), eq(bookings.status, "pending")))
      .returning();
    if (row) return toBooking(row);
    const existing = await this.get(id);
    // 别的会话的预约对这个会话来说就是不存在
    if (!existing || existing.conversationId !== input.conversationId) throw new BookingStateError(`booking not found: ${id}`);
    throw new BookingStateError(`booking ${id} already ${existing.status}`);
  }

  async get(id: string): Promise<Booking | undefined> {
    const [row] = await this.db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return row ? toBooking(row) : undefined;
  }

  async listPending(shopSlug: string): Promise<Booking[]> {
    const rows = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.shopSlug, shopSlug), eq(bookings.status, "pending")))
      .orderBy(asc(bookings.createdAt));
    return rows.map(toBooking);
  }

  async listPendingForConversation(conversationId: string): Promise<Booking[]> {
    const rows = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.conversationId, conversationId), eq(bookings.status, "pending")))
      .orderBy(asc(bookings.createdAt));
    return rows.map(toBooking);
  }

  async decide(id: string, decision: { status: "confirmed" | "declined"; by: string; reason?: string }): Promise<Booking> {
    const [row] = await this.db
      .update(bookings)
      .set({ status: decision.status, decidedAt: new Date(), decidedBy: decision.by, declineReason: decision.reason ?? null })
      .where(and(eq(bookings.id, id), eq(bookings.status, "pending")))
      .returning();
    if (row) return toBooking(row);
    const existing = await this.get(id);
    if (!existing) throw new BookingStateError(`booking not found: ${id}`);
    throw new BookingStateError(`booking ${id} already ${existing.status}`);
  }
}

function toColumns(input: Omit<Booking, "id" | "status" | "createdAt">) {
  return {
    shopSlug: input.shopSlug,
    conversationId: input.conversationId,
    customerName: input.customer.name,
    customerContact: input.customer.contact,
    channel: input.customer.channel,
    pet: input.pet,
    serviceId: input.serviceId,
    start: input.start,
    durationMin: input.durationMin,
    quote: input.quote ?? null,
  };
}

function toBooking(row: Row): Booking {
  const b: Booking = {
    id: row.id,
    shopSlug: row.shopSlug,
    conversationId: row.conversationId,
    status: row.status,
    customer: { name: row.customerName, contact: row.customerContact, channel: row.channel },
    pet: row.pet,
    serviceId: row.serviceId,
    start: row.start,
    durationMin: row.durationMin,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.quote) b.quote = row.quote;
  if (row.decidedAt) b.decidedAt = row.decidedAt.toISOString();
  if (row.decidedBy) b.decidedBy = row.decidedBy;
  if (row.declineReason) b.declineReason = row.declineReason;
  return b;
}
