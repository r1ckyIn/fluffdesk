import { ATTR, type TraceSink } from "@fluffdesk/core";
import type { Db } from "../client.js";
import { traces } from "../schema.js";

/**
 * 轨迹落库。写失败只记日志不抛：finish 在循环的 finally 里，抛出去会把已经生成的回复变成 500。
 */
export function pgTraceSink(db: Db): TraceSink {
  return {
    async onTraceEnd(trace) {
      try {
        const shop = trace.spans.map((s) => s.attributes[ATTR.shop]).find((v): v is string => typeof v === "string");
        await db
          .insert(traces)
          .values({ id: trace.id, conversationId: trace.conversationId, shopSlug: shop ?? null, trace, costUsd: String(trace.totals.costUsd) })
          .onConflictDoNothing();
      } catch (e) {
        console.error(`[trace sink] failed to store ${trace.id}: ${(e as Error).message}`);
      }
    },
  };
}
