import type { Decision } from "./types.js";

/** 美容师端提交的决定不合规矩：路由回 400，带这个 message */
export class DecisionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionInputError";
  }
}

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const MAX_ALTERNATIVES = 3;

/**
 * 把外面来的 JSON 变成 Decision。规矩：
 * - 只有 confirmed / declined；
 * - 替代时段只能跟着 declined，最多 3 个，格式和预约的 start 一样（店铺时区本地时间），不重复；
 * - reason 截到 500 字，by 截到 80 字。
 * 字段逐个取，不展开 body。
 */
export function parseDecision(input: unknown): Decision {
  const body = (input ?? {}) as Record<string, unknown>;
  const status = body.status;
  if (status !== "confirmed" && status !== "declined") throw new DecisionInputError("status must be confirmed|declined");
  if (typeof body.by !== "string" || !body.by.trim()) throw new DecisionInputError("by required");
  const decision: Decision = { status, by: body.by.trim().slice(0, 80) };
  if (typeof body.reason === "string" && body.reason.trim()) decision.reason = body.reason.trim().slice(0, 500);
  const alternatives = body.alternatives;
  if (alternatives !== undefined) {
    if (status === "confirmed") throw new DecisionInputError("alternatives only go with declined");
    if (!Array.isArray(alternatives)) throw new DecisionInputError("alternatives must be an array");
    if (alternatives.length > MAX_ALTERNATIVES) throw new DecisionInputError(`at most ${MAX_ALTERNATIVES} alternatives`);
    for (const a of alternatives) if (typeof a !== "string" || !LOCAL_DATETIME.test(a)) throw new DecisionInputError("each alternative must be YYYY-MM-DDTHH:MM");
    if (new Set(alternatives).size !== alternatives.length) throw new DecisionInputError("alternatives must be distinct");
    if (alternatives.length > 0) decision.alternatives = [...(alternatives as string[])].sort();
  }
  return decision;
}
