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
}

export interface Slot {
  start: string;
  end: string;
}
