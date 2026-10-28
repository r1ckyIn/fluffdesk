import type { Booking, BookingStatus, Decision, Slot } from "./types.js";

/** 日历只读口。实现可以是 Google Calendar、店里自己的表，或者测试用的内存版 */
export interface CalendarPort {
  freeSlots(date: string, durationMin: number): Promise<Slot[]>;
}

/** decide 的业务拒绝（不存在、已经决定过）。路由只把这类错回给调用方，别的错一律当内部错误 */
export class BookingStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingStateError";
  }
}

/** 预约存储。agent 只调 createPending；decide 只给美容师端 */
export interface BookingStore {
  createPending(input: Omit<Booking, "id" | "status" | "createdAt">): Promise<Booking>;
  get(id: string): Promise<Booking | undefined>;
  listPending(shopSlug: string): Promise<Booking[]>;
  /** 美容师端的历史：按状态过滤，决定时间倒序（没决定的按创建时间倒序），有上限 */
  listByStatus(shopSlug: string, statuses: BookingStatus[], limit?: number): Promise<Booking[]>;
  /** 一个会话的待确认预约：hold_booking 用它限流和查重 */
  listPendingForConversation(conversationId: string): Promise<Booking[]>;
  /** 客人改了联系方式或宠物信息再提交同一时段：更新那条待确认的，还是 pending。不是 pending 就抛 BookingStateError */
  updatePending(id: string, input: Omit<Booking, "id" | "status" | "createdAt">): Promise<Booking>;
  decide(id: string, decision: Decision): Promise<Booking>;
}

/** 内存实现：开发、测试、demo 用。id 生成器可注入：录制回放要求工具结果确定，不能带随机数 */
export class InMemoryBookingStore implements BookingStore {
  private items = new Map<string, Booking>();
  constructor(private readonly nextId: () => string = () => `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`) {}

  /** 同会话、同服务、同时段已经挂着就回那条：和 Postgres 版的部分唯一索引同一个语义 */
  async createPending(input: Omit<Booking, "id" | "status" | "createdAt">): Promise<Booking> {
    const existing = (await this.listPendingForConversation(input.conversationId)).find((b) => b.serviceId === input.serviceId && b.start === input.start);
    if (existing) return existing;
    const booking: Booking = {
      ...input,
      id: this.nextId(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.items.set(booking.id, booking);
    return booking;
  }
  async get(id: string) {
    return this.items.get(id);
  }
  async listPending(shopSlug: string) {
    return [...this.items.values()].filter((b) => b.shopSlug === shopSlug && b.status === "pending");
  }
  async listByStatus(shopSlug: string, statuses: BookingStatus[], limit = 100) {
    return [...this.items.values()]
      .filter((b) => b.shopSlug === shopSlug && statuses.includes(b.status))
      .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
      .slice(0, limit);
  }
  async listPendingForConversation(conversationId: string) {
    return [...this.items.values()].filter((b) => b.conversationId === conversationId && b.status === "pending");
  }
  async updatePending(id: string, input: Omit<Booking, "id" | "status" | "createdAt">) {
    const b = this.items.get(id);
    if (!b || b.conversationId !== input.conversationId) throw new BookingStateError(`booking not found: ${id}`);
    if (b.status !== "pending") throw new BookingStateError(`booking ${id} already ${b.status}`);
    Object.assign(b, input, { status: "pending" });
    return b;
  }
  async decide(id: string, decision: Decision) {
    const b = this.items.get(id);
    if (!b) throw new BookingStateError(`booking not found: ${id}`);
    if (b.status !== "pending") throw new BookingStateError(`booking ${id} already ${b.status}`);
    Object.assign(b, { status: decision.status, decidedAt: new Date().toISOString(), decidedBy: decision.by, declineReason: decision.reason, ...decidedFields(decision) });
    return b;
  }
}

/** 内存日历：按营业时间切整点空档，减掉已有预约。够 demo 用 */
export class InMemoryCalendar implements CalendarPort {
  constructor(
    private readonly hoursFor: (date: string) => { open: string; close: string } | null,
    private readonly busy: (date: string) => Promise<Slot[]> = async () => [],
  ) {}

  async freeSlots(date: string, durationMin: number): Promise<Slot[]> {
    const hours = this.hoursFor(date);
    if (!hours) return [];
    const taken = await this.busy(date);
    const out: Slot[] = [];
    let cursor = toMinutes(hours.open);
    const close = toMinutes(hours.close);
    while (cursor + durationMin <= close) {
      const start = `${date}T${fromMinutes(cursor)}`;
      const end = `${date}T${fromMinutes(cursor + durationMin)}`;
      if (!taken.some((t) => t.start < end && start < t.end)) out.push({ start, end });
      cursor += 60;
    }
    return out;
  }
}

/** 替代时段只随 declined 落库：confirmed 带着 alternatives 进来也不存，内存版和 Postgres 版同一个语义 */
export function decidedFields(decision: Decision): Pick<Booking, "alternatives"> {
  return decision.status === "declined" && decision.alternatives?.length ? { alternatives: [...decision.alternatives] } : {};
}

/** 一条预约占的时段，给日历减掉用 */
export function bookingSlot(b: Pick<Booking, "start" | "durationMin">): Slot {
  const [date, hhmm] = b.start.split("T") as [string, string];
  return { start: b.start, end: `${date}T${fromMinutes(toMinutes(hhmm) + b.durationMin)}` };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
