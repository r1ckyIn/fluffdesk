import type { Gateway, TurnResult } from "@fluffdesk/core";

/**
 * 模型评审。只在确定性检查全过之后跑，评的是"像不像店员、有没有多说"。
 * 上线前要和人工打分对齐到 75% 以上才算数，对齐数据放 datasets/judge-calibration.jsonl（待建）。
 */
export async function judge(gateway: Gateway, rubric: string, transcript: TurnResult[]): Promise<{ score: number; reason: string }> {
  const res = await gateway.complete("judge", {
    systemPrompt: "You grade a pet grooming booking assistant. Output JSON only: {\"score\": 1-5, \"reason\": string}.",
    messages: [{ role: "user", content: `Rubric:\n${rubric}\n\nAssistant replies:\n${transcript.map((t, i) => `${i + 1}. ${t.reply}`).join("\n")}`, timestamp: Date.now() }],
  }, { maxTokens: 200 });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
  } catch {
    return { score: 0, reason: `unparseable: ${text}` };
  }
}
