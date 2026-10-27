import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway, defaultTools, newConversation, runTurn, InMemoryBookingStore, InMemoryCalendar, parseShopConfig, type ShopConfig } from "@fluffdesk/core";
import { gradeDeterministic, type Expectation } from "./graders/deterministic.js";

/**
 * 用法：npm run eval -- quote            跑 datasets/quote.jsonl，用真模型（花钱，读 .env）
 *       npm run eval -- quote --dry      只校验数据集格式，不调模型
 * 结果写到 runs/<dataset>-<时间>.json，拿来和上一次比。
 */
interface Case {
  id: string;
  source: string;
  shop: string;
  locale: "en" | "zh";
  turns: Array<{ text?: string; images?: Array<{ path: string; mimeType: string }> }>;
  expect: Expectation;
  judge?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const dry = process.argv.includes("--dry");
if (!name) {
  console.error("usage: npm run eval -- <dataset> [--dry]");
  process.exit(2);
}

const cases: Case[] = readFileSync(resolve(here, "../datasets", `${name}.jsonl`), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const shops: Record<string, ShopConfig> = JSON.parse(readFileSync(resolve(here, "../datasets/shops.json"), "utf8"));
for (const k of Object.keys(shops)) shops[k] = parseShopConfig(shops[k]);

if (dry) {
  for (const c of cases) if (!shops[c.shop]) throw new Error(`${c.id}: unknown shop ${c.shop}`);
  console.log(`${cases.length} cases ok`);
  process.exit(0);
}

const gateway = createGateway();
const summary: Array<{ id: string; pass: boolean; checks: ReturnType<typeof gradeDeterministic>; costUsd: number; replies: string[]; toolCalls: unknown[] }> = [];

for (const c of cases) {
  const shop = shops[c.shop]!;
  const deps = {
    gateway, shop, tools: defaultTools(),
    toolContext: { bookings: new InMemoryBookingStore(), calendar: new InMemoryCalendar(() => ({ open: "09:00", close: "17:00" })) },
    today: () => "2026-11-01",
  };
  const conv = newConversation({ id: `eval-${c.id}`, shopSlug: shop.slug, channel: "eval", locale: c.locale });
  const results = [];
  for (const t of c.turns) {
    const images = (t.images ?? []).map((i) => ({ data: readFileSync(resolve(here, "../datasets", i.path)).toString("base64"), mimeType: i.mimeType }));
    results.push(await runTurn(deps, conv, { text: t.text, images }));
  }
  const checks = gradeDeterministic(shop, c.locale, results, c.expect);
  const pass = checks.every((k) => k.pass);
  const costUsd = results.reduce((s, r) => s + r.costUsd, 0);
  summary.push({ id: c.id, pass, checks, costUsd, replies: results.map((r) => r.reply), toolCalls: results.flatMap((r) => r.toolCalls.map((t) => ({ name: t.name, args: t.args, isError: t.isError }))) });
  console.log(`${pass ? "PASS" : "FAIL"} ${c.id}  $${costUsd.toFixed(4)}`);
  for (const k of checks) if (!k.pass) console.log(`     x ${k.name}${k.detail ? `: ${k.detail}` : ""}`);
}

const passed = summary.filter((s) => s.pass).length;
const cost = summary.reduce((s, r) => s + r.costUsd, 0);
console.log(`\n${passed}/${summary.length} passed, cost $${cost.toFixed(4)}`);
mkdirSync(resolve(here, "../runs"), { recursive: true });
const out = resolve(here, "../runs", `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ dataset: name, passed, total: summary.length, cost, cases: summary }, null, 2));
console.log(`wrote ${out}`);
process.exit(passed === summary.length ? 0 : 1);
