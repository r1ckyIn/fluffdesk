import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGateway, defaultTools, newConversation, runTurn, InMemoryBookingStore, InMemoryCalendar, parseShopConfig,
  recordingGateway, replayGateway, type Gateway, type Recording, type ShopConfig, type TurnResult,
} from "@fluffdesk/core";
import { gradeDeterministic, type Check, type Expectation } from "./graders/deterministic.js";

export interface Case {
  id: string;
  source: string;
  shop: string;
  locale: "en" | "zh";
  turns: Array<{ text?: string; images?: Array<{ path: string; mimeType: string }> }>;
  expect: Expectation;
  judge?: string;
}

export interface CaseResult {
  id: string;
  pass: boolean;
  checks: Check[];
  costUsd: number;
  replies: string[];
  toolCalls: Array<{ name: string; args: unknown; isError: boolean }>;
}

export const EVAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXED_TODAY = "2026-11-01";

export function loadDataset(name: string): Case[] {
  return readFileSync(resolve(EVAL_ROOT, "datasets", `${name}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export function loadShops(): Record<string, ShopConfig> {
  const raw = JSON.parse(readFileSync(resolve(EVAL_ROOT, "datasets/shops.json"), "utf8")) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, parseShopConfig(v)]));
}

export function recordingPath(dataset: string, caseId: string): string {
  return resolve(EVAL_ROOT, "recordings", dataset, `${caseId}.json`);
}

export function loadRecording(dataset: string, caseId: string): Recording[] | undefined {
  const p = recordingPath(dataset, caseId);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Recording[]) : undefined;
}

export type Mode = { kind: "live"; record?: string } | { kind: "replay"; dataset: string };

/** 跑一条用例：建会话、逐轮喂输入、确定性评分。mode 决定模型是真的、录制的还是回放的 */
export async function runCase(c: Case, shops: Record<string, ShopConfig>, mode: Mode, liveGateway?: Gateway): Promise<CaseResult> {
  const shop = shops[c.shop];
  if (!shop) throw new Error(`${c.id}: unknown shop ${c.shop}`);

  let gateway: Gateway;
  const recorded: Recording[] = [];
  if (mode.kind === "replay") {
    const recs = loadRecording(mode.dataset, c.id);
    if (!recs) throw new Error(`${c.id}: no recording, run with --record first`);
    gateway = replayGateway(recs);
  } else {
    const live = liveGateway ?? createGateway();
    gateway = mode.record ? recordingGateway(live, (r) => recorded.push(r)) : live;
  }

  // 预约 id 用序号：工具结果进指纹，带随机数就没法回放
  let seq = 0;
  const bookings = new InMemoryBookingStore(() => `bk_eval_${++seq}`);
  const deps = {
    gateway, shop, tools: defaultTools(),
    toolContext: { bookings, calendar: new InMemoryCalendar(() => ({ open: "09:00", close: "17:00" })) },
    today: () => FIXED_TODAY,
  };
  const conv = newConversation({ id: `eval-${c.id}`, shopSlug: shop.slug, channel: "eval", locale: c.locale });
  const results: TurnResult[] = [];
  for (const t of c.turns) {
    const images = (t.images ?? []).map((i) => ({ data: readFileSync(resolve(EVAL_ROOT, "datasets", i.path)).toString("base64"), mimeType: i.mimeType }));
    results.push(await runTurn(deps, conv, { text: t.text, images }));
  }
  const pending = await bookings.listPending(shop.slug);
  const checks = gradeDeterministic(shop, c.locale, results, c.expect, { pendingBookings: pending.length });

  if (mode.kind === "live" && mode.record) {
    const p = recordingPath(mode.record, c.id);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(recorded, null, 2));
  }
  return {
    id: c.id,
    pass: checks.every((k) => k.pass),
    checks,
    costUsd: results.reduce((s, r) => s + r.costUsd, 0),
    replies: results.map((r) => r.reply),
    toolCalls: results.flatMap((r) => r.toolCalls.map((t) => ({ name: t.name, args: t.args, isError: t.isError }))),
  };
}
