import type { ShopConfig, Weekday } from "../schema.js";
import type { ShopDraft } from "./index.js";

/**
 * Google 商家导入：Places API (New) Text Search。确定性映射，不过模型。
 * 拿：名称、地址、电话、官网、营业时间。需要 GOOGLE_MAPS_API_KEY。
 */
export interface GoogleImportOptions {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
}

interface PlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    regularOpeningHours?: { periods?: Array<{ open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } }> };
  }>;
}

const DAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export async function importGoogleBusiness(query: string, opts: GoogleImportOptions = {}): Promise<ShopDraft> {
  const apiKey = opts.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const fetchedAt = new Date().toISOString();
  const source = { type: "google" as const, fetchedAt };
  if (!apiKey) return { source, partial: {}, confidence: {}, rawNotes: ["GOOGLE_MAPS_API_KEY not set"] };

  const res = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours",
    },
    body: JSON.stringify({ textQuery: query, regionCode: "AU", languageCode: "en", maxResultCount: 3 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { source, partial: {}, confidence: {}, rawNotes: [`places api ${res.status}: ${(await res.text()).slice(0, 200)}`] };
  const data = (await res.json()) as PlacesResponse;
  const place = data.places?.[0];
  if (!place) return { source, partial: {}, confidence: {}, rawNotes: [`no place found for "${query}"`] };

  const partial: Partial<ShopConfig> = {};
  const confidence: ShopDraft["confidence"] = {};
  const notes: string[] = [`matched place ${place.id} "${place.displayName?.text ?? ""}"`];
  if ((data.places?.length ?? 0) > 1) notes.push(`other candidates: ${data.places!.slice(1).map((p) => p.displayName?.text).join(" | ")}`);
  if (place.displayName?.text) { partial.name = place.displayName.text; confidence.name = 0.95; }
  if (place.formattedAddress) { partial.address = place.formattedAddress; confidence.address = 0.95; }
  if (place.nationalPhoneNumber) { partial.phone = place.nationalPhoneNumber; confidence.phone = 0.95; }
  if (place.websiteUri) partial.website = place.websiteUri;
  if (place.regularOpeningHours?.periods) { partial.hours = mapHours(place.regularOpeningHours.periods); confidence.hours = 0.9; }
  return { source: { ...source, url: `https://www.google.com/maps/place/?q=place_id:${place.id}` }, partial, confidence, rawNotes: notes };
}

export function mapHours(periods: NonNullable<NonNullable<PlacesResponse["places"]>[number]["regularOpeningHours"]>["periods"]): ShopConfig["hours"] {
  const hours = Object.fromEntries(DAYS.map((d) => [d, null])) as ShopConfig["hours"];
  for (const p of periods ?? []) {
    const day = DAYS[p.open.day];
    if (!day || !p.close) continue;
    const open = hhmm(p.open.hour, p.open.minute);
    const close = hhmm(p.close.hour, p.close.minute);
    const cur = hours[day];
    hours[day] = cur ? { open: cur.open < open ? cur.open : open, close: cur.close > close ? cur.close : close } : { open, close };
  }
  return hours;
}

function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
