import { computeQuote, type ShopConfig, type TurnResult } from "@fluffdesk/core";

/** 一条用例的确定性期望。先用这些过一遍，再决定要不要花钱请模型评审 */
export interface Expectation {
  toolCalled?: string;
  toolNotCalled?: string;
  priceWithin?: { serviceId: string; size: string; coat?: string };
  noPriceBelow?: { serviceId: string };
  mentionsDisclaimer?: boolean;
  asksFor?: string[];
  neverSays?: string[];
  /** 这轮结束时待确认预约的数量 */
  pendingBookings?: number;
  /** 回复里至少出现其中一个（不区分大小写） */
  saysAny?: string[];
  /** 回复必须匹配 / 不得匹配的正则 */
  replyMatches?: string;
  replyNotMatches?: string;
}

export interface GradeContext {
  pendingBookings: number;
}

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export function gradeDeterministic(shop: ShopConfig, locale: "en" | "zh", results: TurnResult[], expect: Expectation, ctx: GradeContext = { pendingBookings: 0 }): Check[] {
  const last = results[results.length - 1]!;
  const reply = results.map((r) => r.reply).join("\n");
  const allCalls = results.flatMap((r) => r.toolCalls);
  const checks: Check[] = [];

  if (expect.toolCalled) checks.push({ name: `called ${expect.toolCalled}`, pass: allCalls.some((c) => c.name === expect.toolCalled) });
  if (expect.toolNotCalled) checks.push({ name: `did not call ${expect.toolNotCalled}`, pass: !allCalls.some((c) => c.name === expect.toolNotCalled) });

  const prices = extractPrices(reply);
  if (expect.priceWithin) {
    const q = computeQuote(shop, expect.priceWithin.serviceId, expect.priceWithin.size, expect.priceWithin.coat as never);
    const ok = prices.length > 0 && prices.every((p) => p >= q.min && p <= q.max);
    checks.push({ name: "prices within list", pass: ok, detail: `found ${prices.join(",")} expected ${q.min}-${q.max}` });
  }
  if (expect.noPriceBelow) {
    const floor = Math.min(...shop.services.find((s) => s.id === expect.noPriceBelow!.serviceId)!.prices.map((p) => p.min));
    checks.push({ name: "no price below list", pass: prices.every((p) => p >= floor), detail: `found ${prices.join(",")} floor ${floor}` });
  }
  if (expect.mentionsDisclaimer) {
    const d = shop.policies.quoteDisclaimer[locale];
    const key = locale === "zh" ? "到店" : "in store";
    checks.push({ name: "mentions disclaimer", pass: reply.includes(d) || reply.toLowerCase().includes(key) });
  }
  if (expect.asksFor) {
    checks.push({ name: `asks for ${expect.asksFor.join("|")}`, pass: expect.asksFor.some((w) => reply.toLowerCase().includes(w)) });
  }
  if (expect.saysAny) {
    checks.push({ name: `says one of ${expect.saysAny.join("|")}`, pass: expect.saysAny.some((w) => reply.toLowerCase().includes(w.toLowerCase())) });
  }
  if (expect.replyMatches) checks.push({ name: `reply matches /${expect.replyMatches}/`, pass: new RegExp(expect.replyMatches, "u").test(reply) });
  if (expect.replyNotMatches) checks.push({ name: `reply does not match /${expect.replyNotMatches}/`, pass: !new RegExp(expect.replyNotMatches, "u").test(reply) });
  for (const phrase of expect.neverSays ?? []) {
    checks.push({ name: `never says "${phrase}"`, pass: !reply.toLowerCase().includes(phrase.toLowerCase()) });
  }
  if (expect.pendingBookings !== undefined) {
    checks.push({ name: `${expect.pendingBookings} pending booking(s)`, pass: ctx.pendingBookings === expect.pendingBookings, detail: `found ${ctx.pendingBookings}` });
  }
  checks.push({ name: "turn finished normally", pass: last.stop === "done", detail: last.stop });
  return checks;
}

/** 从回复里抓看起来像澳元价格的数字 */
export function extractPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:AUD|A?\$)\s?(\d{2,4})(?:\s?[-–~到]\s?(?:AUD|A?\$)?\s?(\d{2,4}))?/gi)) {
    out.push(Number(m[1]));
    if (m[2]) out.push(Number(m[2]));
  }
  return out;
}
