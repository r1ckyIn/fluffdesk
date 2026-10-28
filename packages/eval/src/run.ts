import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createGateway } from "@fluffdesk/core";
import { EVAL_ROOT, loadDataset, loadShops, runCase, type CaseResult, type Mode } from "./runner.js";

/**
 * 用法：
 *   npm run eval -- quote                 真模型跑一遍（花钱，读 .env）
 *   npm run eval -- quote --record        真模型跑并录制到 recordings/quote/<id>.json
 *   npm run eval -- quote --replay        按录制回放，不花钱，CI 用；请求对不上录制就失败
 *   npm run eval -- quote --runs 3        每条跑 3 次，全过才算过（pass^k）
 *   npm run eval -- quote --only book-001 只跑（或只重录）指定用例，逗号分隔
 *   npm run eval -- quote --dry           只校验数据集格式
 * 结果写到 runs/<dataset>-<时间>.json，拿来和上一次比。
 */
const { values: opts, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { record: { type: "boolean" }, replay: { type: "boolean" }, dry: { type: "boolean" }, runs: { type: "string" }, only: { type: "string" } },
});
const name = positionals[0];
const runs = Math.max(1, Number(opts.runs ?? "1") || 1);
const only = opts.only ? new Set(opts.only.split(",")) : undefined;
if (!name) {
  console.error("usage: npm run eval -- <dataset> [--record|--replay] [--runs k] [--dry]");
  process.exit(2);
}

const cases = loadDataset(name).filter((c) => !only || only.has(c.id));
const shops = loadShops();
if (opts.dry) {
  for (const c of cases) if (!shops[c.shop]) throw new Error(`${c.id}: unknown shop ${c.shop}`);
  console.log(`${cases.length} cases ok`);
  process.exit(0);
}

const mode: Mode = opts.replay ? { kind: "replay", dataset: name } : { kind: "live", record: opts.record ? name : undefined };
const live = mode.kind === "live" ? createGateway() : undefined;
const summary: Array<CaseResult & { runs: number; passedRuns: number }> = [];

for (const c of cases) {
  // pass^k：保留第一个失败的那轮，没失败就留最后一轮。只留最后一轮的话，flaky 的失败看不到是哪条 check 挂的
  let shown: CaseResult | undefined;
  let last: CaseResult | undefined;
  let passedRuns = 0;
  let cost = 0;
  for (let i = 0; i < runs; i++) {
    last = await runCase(c, shops, mode, live);
    cost += last.costUsd;
    if (last.pass) passedRuns++;
    else shown ??= last;
  }
  const result = shown ?? last!;
  const pass = passedRuns === runs;
  summary.push({ ...result, pass, costUsd: cost, runs, passedRuns });
  console.log(`${pass ? "PASS" : "FAIL"} ${c.id}${runs > 1 ? `  ${passedRuns}/${runs}` : ""}  $${cost.toFixed(4)}`);
  if (!pass) for (const k of result.checks) if (!k.pass) console.log(`     x ${k.name}${k.detail ? `: ${k.detail}` : ""}`);
}

const passed = summary.filter((s) => s.pass).length;
const cost = summary.reduce((s, r) => s + r.costUsd, 0);
console.log(`\n${passed}/${summary.length} passed${runs > 1 ? ` (pass^${runs})` : ""}, cost $${cost.toFixed(4)}${mode.kind === "replay" ? " (replay)" : ""}`);
mkdirSync(resolve(EVAL_ROOT, "runs"), { recursive: true });
const out = resolve(EVAL_ROOT, "runs", `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify({ dataset: name, mode: mode.kind, runs, passed, total: summary.length, cost, cases: summary }, null, 2));
console.log(`wrote ${out}`);
process.exit(passed === summary.length ? 0 : 1);
