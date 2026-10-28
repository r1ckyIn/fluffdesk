import type { Booking, Slot } from "./types.js";

/** 日历只读口。实现可以是 Google Calendar、店里自己的表，或者测试用的内存版 */
export interface CalendarPort {
  freeSlots(date: string, durationMin: number): Promise<Slot[]>;
}

/** 预约存储。agent 只调 createPending；decide 只给美容师端 */
export interface BookingStore {
  createPending(input: Omit<Booking, "id" | "status" | "createdAt">): Promise<Booking>;
  get(id: string): Promise<Booking | undefined>;
  listPending(shopSlug: string): Promise<Booking[]>;
  /** 一个会话已经挂了几个待确认预约，hold_booking 用它限流 */
  countPendingForConversation(conversationId: string): Promise<number>;
  decide(id: string, decision: { status: "confirmed" | "declined"; by: string; reason?: string }): Promise<Booking>;
}

/** 内存实现：开发、测试、demo 用。id 生成器可注入：录制回放要求工具结果确定，不能带随机数 */
export class InMemoryBookingStore implements BookingStore {
  private items = new Map<string, Booking>();
  constructor(private readonly nextId: () => string = () => `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`) {}

  async createPending(input: Omit<Booking, "id" | "status" | "createdAt">): Promise<Booking> {
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
  async countPendingForConversation(conversationId: string) {
    return [...this.items.values()].filter((b) => b.conversationId === conversationId && b.status === "pending").length;
  }
  async decide(id: string, decision: { status: "confirmed" | "declined"; by: string; reason?: string }) {
    const b = this.items.get(id);
    if (!b) throw new Error(`booking not found: ${id}`);
    if (b.status !== "pending") throw new Error(`booking ${id} already ${b.status}`);
    Object.assign(b, { status: decision.status, decidedAt: new Date().toISOString(), decidedBy: decision.by, declineReason: decision.reason });
    return b;
  }
}

/** 内存日历：按营业时间切整点空档，减掉已有预约。够 demo 用 */
export class InMemoryCalendar implements CalendarPort {
  constructor(
    private readonly hoursFor: (date: string) => { open: string; close: string } | null,
    private readonly busy: () => Promise<Slot[]> = async () => [],
  ) {}

  async freeSlots(date: string, durationMin: number): Promise<Slot[]> {
    const hours = this.hoursFor(date);
    if (!hours) return [];
    const taken = await this.busy();
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

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
