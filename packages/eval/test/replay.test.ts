import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { loadDataset, loadShops, recordingPath, runCase } from "../src/runner.js";
import { ReplayMissError } from "@fluffdesk/core";

/**
 * 录制回放的 e2e：用真实模型录下来的回复，从外部接口（一条客人消息）跑完整个循环，
 * 再用确定性评分器打分。不花钱、确定。指纹对不上说明提示词或工具变了，要重录。
 */
const DATASET = "quote";
const cases = loadDataset(DATASET);
const shops = loadShops();

describe(`eval replay: ${DATASET}`, () => {
  it("every case has a recording", () => {
    const missing = cases.filter((c) => !existsSync(recordingPath(DATASET, c.id))).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s passes on replay", async (_id, c) => {
    const r = await runCase(c, shops, { kind: "replay", dataset: DATASET });
    expect(r.checks.filter((k) => !k.pass).map((k) => `${k.name}${k.detail ? `: ${k.detail}` : ""}`)).toEqual([]);
  });

  it("fails loudly when the request does not match the recording", async () => {
    const c = { ...cases[0]!, id: cases[0]!.id, turns: [{ text: "something never recorded" }] };
    await expect(runCase(c, shops, { kind: "replay", dataset: DATASET })).rejects.toBeInstanceOf(ReplayMissError);
  });
});
