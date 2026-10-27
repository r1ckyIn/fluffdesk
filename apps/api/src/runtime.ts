import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGateway, defaultTools, consoleTraceSink, parseShopConfig,
  InMemoryBookingStore, InMemoryCalendar, Tracer,
  type Conversation, type Gateway, type ShopConfig, type BookingStore, type TraceSink, type Correction,
} from "@fluffdesk/core";

/**
 * 进程级依赖。现在全是内存实现，接 Postgres 时只换这里，路由不动。
 * TODO: shops/conversations/bookings/corrections 换成 @fluffdesk/db
 */
export interface Runtime {
  gateway: Gateway;
  shops: { get(slug: string): ShopConfig | undefined; list(): ShopConfig[] };
  conversations: Map<string, Conversation>;
  bookings: BookingStore;
  corrections: Correction[];
  traceSinks: TraceSink[];
  newTracer(conversationId: string): Tracer;
  calendarFor(shop: ShopConfig): InMemoryCalendar;
  tools: ReturnType<typeof defaultTools>;
}

export function createRuntime(): Runtime {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(resolve(here, "../../../packages/eval/datasets/shops.json"), "utf8")) as Record<string, unknown>;
  const shops = new Map(Object.values(raw).map((s) => {
    const cfg = parseShopConfig(s);
    return [cfg.slug, cfg] as const;
  }));
  const bookings = new InMemoryBookingStore();
  const traceSinks: TraceSink[] = [consoleTraceSink];
  return {
    gateway: createGateway(),
    shops: { get: (slug) => shops.get(slug), list: () => [...shops.values()] },
    conversations: new Map(),
    bookings,
    corrections: [],
    traceSinks,
    newTracer: (id) => new Tracer(id, traceSinks),
    calendarFor: (shop) =>
      new InMemoryCalendar((date) => {
        const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T00:00:00`).getDay()] as keyof ShopConfig["hours"];
        return shop.hours[day] ?? null;
      }),
    tools: defaultTools(),
  };
}
