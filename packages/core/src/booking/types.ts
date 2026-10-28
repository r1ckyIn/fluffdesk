/**
 * 预约状态机。agent 只能创建 pending；confirmed/declined 只能由美容师端的接口改。
 * 这是"写操作必须等美容师确认"这条规矩在类型上的落点。
 */
export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled";

export interface PetSummary {
  name?: string;
  species: "dog" | "cat" | "other";
  breedGuess?: string;
  sizeTier?: string;
  coat?: string;
  weightKg?: number;
  notes?: string;
}

export interface Booking {
  id: string;
  shopSlug: string;
  conversationId: string;
  status: BookingStatus;
  customer: { name: string; contact: string; channel: string };
  pet: PetSummary;
  serviceId: string;
  /** ISO datetime，店铺时区 */
  start: string;
  durationMin: number;
  quote?: { min: number; max: number; currency: "AUD" };
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  declineReason?: string;
  /** 拒绝时给客人的替代时段（店铺时区，YYYY-MM-DDTHH:MM），最多 3 个；只有 declined 才有 */
  alternatives?: string[];
}

/** 美容师的决定。只有这两种状态能由人改出来；cancelled 留给以后的客人取消 */
export interface Decision {
  status: "confirmed" | "declined";
  by: string;
  reason?: string;
  alternatives?: string[];
}

export interface Slot {
  start: string;
  end: string;
}
