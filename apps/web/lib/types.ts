/**
 * 和 packages/core 里的领域类型保持一致的前端副本。
 * 不直接 import @fluffdesk/core：Vercel 以 apps/web 为根单独装依赖，workspace 包不在。
 * 改 core 的 Booking / ShopConfig 时同步改这里。
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
  /** 店铺时区本地时间 YYYY-MM-DDTHH:MM */
  start: string;
  durationMin: number;
  quote?: { min: number; max: number; currency: "AUD" };
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  declineReason?: string;
  alternatives?: string[];
}

export interface I18nText {
  en: string;
  zh: string;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export type CoatType = "short" | "double" | "curly" | "wire" | "long";
export const COATS: CoatType[] = ["short", "double", "curly", "wire", "long"];

export interface PriceRule {
  size: string;
  coat?: CoatType;
  min: number;
  max: number;
}

export interface Service {
  id: string;
  name: I18nText;
  description?: I18nText;
  durationMin: number;
  prices: PriceRule[];
}

export interface SizeTier {
  id: string;
  label: I18nText;
  maxKg?: number;
}

export interface ShopConfig {
  slug: string;
  name: string;
  timezone: string;
  currency: "AUD";
  address?: string;
  phone?: string;
  website?: string;
  hours: Record<Weekday, { open: string; close: string } | null>;
  sizeTiers: SizeTier[];
  services: Service[];
  policies: { quoteDisclaimer: I18nText; notes?: I18nText };
  sources?: unknown[];
}

export interface TranscriptEntry {
  role: "customer" | "agent" | "tool";
  text: string;
  imageIds?: string[];
  at?: number;
  tool?: { name: string; isError: boolean };
}

export interface ConversationView {
  id: string;
  channel: string;
  locale: "en" | "zh";
  entries: TranscriptEntry[];
  images: string[];
}

export interface Slot {
  start: string;
  end: string;
}

export interface Correction {
  id: string;
  shopSlug: string;
  conversationId: string;
  kind: "pet_identification" | "quote" | "reply";
  original: unknown;
  corrected: unknown;
  note?: string;
  by: string;
  createdAt: string;
}
