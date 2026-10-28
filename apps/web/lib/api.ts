import type { Booking, ConversationView, Correction, ShopConfig, Slot } from "./types";
import type { GroomerSession } from "./session";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(session: GroomerSession, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}/groomer/${encodeURIComponent(session.shop)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${session.token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(r.status, body.error ?? `request failed (${r.status})`);
  }
  return (await r.json()) as T;
}

export const api = {
  shop: (s: GroomerSession) => call<{ shop: ShopConfig }>(s, "/shop").then((x) => x.shop),
  saveShop: (s: GroomerSession, shop: ShopConfig) => call<{ shop: ShopConfig }>(s, "/shop", { method: "PUT", body: JSON.stringify(shop) }).then((x) => x.shop),
  bookings: (s: GroomerSession, status: "pending" | "decided" | "all") => call<{ items: Booking[] }>(s, `/bookings?status=${status}`).then((x) => x.items),
  /** 某天已确认的全部预约：当天安排条用它，不用"最近 N 条决定"去筛 */
  confirmedOn: (s: GroomerSession, date: string) => call<{ items: Booking[] }>(s, `/bookings?date=${encodeURIComponent(date)}`).then((x) => x.items),
  decide: (s: GroomerSession, id: string, decision: { status: "confirmed" | "declined"; reason?: string; alternatives?: string[] }) =>
    call<{ booking: Booking }>(s, `/bookings/${encodeURIComponent(id)}/decide`, { method: "POST", body: JSON.stringify({ ...decision, by: s.name }) }).then((x) => x.booking),
  conversation: (s: GroomerSession, id: string) => call<ConversationView>(s, `/conversations/${encodeURIComponent(id)}`),
  imageUrl: (s: GroomerSession, conversationId: string, imageId: string) =>
    `${API}/groomer/${encodeURIComponent(s.shop)}/conversations/${encodeURIComponent(conversationId)}/images/${encodeURIComponent(imageId)}`,
  /** 图片接口要带 Bearer，<img src> 带不了，所以取回来变成 blob URL */
  imageBlob: async (s: GroomerSession, conversationId: string, imageId: string) => {
    const r = await fetch(api.imageUrl(s, conversationId, imageId), { headers: { authorization: `Bearer ${s.token}` } });
    if (!r.ok) throw new ApiError(r.status, "image unavailable");
    return URL.createObjectURL(await r.blob());
  },
  availability: (s: GroomerSession, date: string, serviceId: string) =>
    call<{ slots: Slot[] }>(s, `/availability?date=${encodeURIComponent(date)}&serviceId=${encodeURIComponent(serviceId)}`).then((x) => x.slots),
  corrections: (s: GroomerSession) => call<{ items: Correction[] }>(s, "/corrections").then((x) => x.items),
  correct: (s: GroomerSession, c: { conversationId: string; kind: Correction["kind"]; original: unknown; corrected: unknown; note?: string }) =>
    call<{ correction: Correction }>(s, "/corrections", { method: "POST", body: JSON.stringify({ ...c, by: s.name }) }).then((x) => x.correction),
};
