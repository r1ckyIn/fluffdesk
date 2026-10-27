import { Type, validateToolCall, type Context, type ImageContent, type Message, type Static, type TextContent, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import type { Gateway } from "../../llm/gateway.js";
import { DayHours, I18nText, PriceRule, SizeTier, Weekday, type ShopConfig, type ShopSource } from "../schema.js";
import type { ShopDraft } from "./index.js";

/**
 * 抽取器：文本和图片进，店铺配置草稿出。三层保证输出可用：
 *  1. 模型不是"吐 JSON 文本"，而是调用 submit_shop_draft 工具，参数由 provider 按 schema 约束
 *     （Anthropic strict tools），再由 validateToolCall 在本地按同一份 TypeBox schema 校验
 *  2. 校验失败把错误原样回给模型重试，最多 MAX_ATTEMPTS 次；还不行就返回空草稿加说明，不抛异常
 *  3. 通过校验之后做确定性核对：每条价目要附 evidence 原文片段，片段和数字必须能在来源文本里找到，
 *     找不到的服务置信度归零，由人工看。模型"编"出来的价格进不了草稿
 */
export const DraftService = Type.Object({
  id: Type.String({ description: "kebab-case id, e.g. full-groom" }),
  name: I18nText,
  durationMin: Type.Optional(Type.Integer({ minimum: 15 })),
  prices: Type.Array(PriceRule, { minItems: 1 }),
  evidence: Type.String({ description: "verbatim snippet from the source that states these prices" }),
});

export const DraftSchema = Type.Object({
  name: Type.Optional(Type.String()),
  address: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  website: Type.Optional(Type.String()),
  hours: Type.Optional(Type.Partial(Type.Record(Weekday, DayHours))),
  sizeTiers: Type.Optional(Type.Array(SizeTier, { minItems: 1 })),
  services: Type.Optional(Type.Array(DraftService)),
  notes: Type.Optional(I18nText),
  unsure: Type.Array(Type.String({ description: "things the source did not state clearly" })),
});
export type Draft = Static<typeof DraftSchema>;

export const submitDraftTool: Tool<typeof DraftSchema> = {
  name: "submit_shop_draft",
  description: "Submit the extracted shop profile. Only include facts stated in the source. Put anything unclear in `unsure`.",
  parameters: DraftSchema,
  constrainedSampling: { type: "json_schema", strict: "prefer" },
};

export interface ExtractInput {
  source: ShopSource;
  text?: string;
  images?: Array<{ data: string; mimeType: string }>;
  hints?: { name?: string; slug?: string };
}

const MAX_ATTEMPTS = 3;
const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const SYSTEM = `You extract a pet grooming salon's public profile into a structured draft for a booking assistant.

Rules:
- Only include what the source states. Never invent prices, hours or services. If unsure, leave the field out and add a note in \`unsure\`.
- Prices: give min and max in AUD as stated. A single price means min = max. "from $90" means min 90 and max 90 with a note in unsure. Each service needs an \`evidence\` snippet copied verbatim from the source.
- Size tiers: use the salon's own tiers if stated (e.g. small/medium/large with weight limits). If the source lists prices per breed instead, map breeds to tiers and say so in unsure.
- Hours: 24h "HH:MM". A closed day is null. Only include days the source states.
- Names: give both en and zh; translate the one that is missing.
- When done, call submit_shop_draft exactly once.`;

export async function extractShopDraft(gateway: Gateway, input: ExtractInput): Promise<ShopDraft> {
  const content: Array<TextContent | ImageContent> = [];
  if (input.hints?.name) content.push({ type: "text", text: `Salon name hint: ${input.hints.name}` });
  if (input.text) content.push({ type: "text", text: `Source (${input.source.type}${input.source.url ? ` ${input.source.url}` : ""}):\n\n${input.text}` });
  for (const img of input.images ?? []) content.push({ type: "image", data: img.data, mimeType: img.mimeType });
  if (content.length === 0) return emptyDraft(input.source, ["no input"]);

  const messages: Message[] = [{ role: "user", content, timestamp: Date.now() }];
  const context: Context = { systemPrompt: SYSTEM, messages, tools: [submitDraftTool] };
  const notes: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await gateway.complete("chat", context, { maxTokens: 4000, reasoning: "low" });
    if (res.stopReason === "error") {
      notes.push(`attempt ${attempt}: model error ${res.errorMessage ?? ""}`);
      continue;
    }
    messages.push(res);
    const call = res.content.find((b): b is ToolCall => b.type === "toolCall" && b.name === submitDraftTool.name);
    if (!call) {
      notes.push(`attempt ${attempt}: no tool call`);
      messages.push({ role: "user", content: "Call submit_shop_draft with what you found.", timestamp: Date.now() });
      continue;
    }
    let draft: Draft;
    try {
      draft = validateToolCall([submitDraftTool], call) as Draft;
    } catch (e) {
      notes.push(`attempt ${attempt}: invalid draft: ${(e as Error).message}`);
      messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: `Invalid: ${(e as Error).message}. Fix and call again.` }], isError: true, timestamp: Date.now() });
      continue;
    }
    return verifyDraft(draft, input, notes);
  }
  return emptyDraft(input.source, [...notes, "gave up after retries"]);
}

/** 确定性核对：图片来源没法逐字对，只核文本来源 */
export function verifyDraft(draft: Draft, input: ExtractInput, notes: string[] = []): ShopDraft {
  const haystack = input.text ? normalize(input.text) : undefined;
  const confidence: ShopDraft["confidence"] = {};
  const partial: Partial<ShopConfig> = {};

  if (draft.name) { partial.name = draft.name; confidence.name = haystack ? (haystack.includes(normalize(draft.name)) ? 1 : 0.5) : 0.7; }
  if (draft.address) { partial.address = draft.address; confidence.address = haystack ? (containsLoosely(haystack, draft.address) ? 1 : 0.3) : 0.6; }
  if (draft.phone) { partial.phone = draft.phone; confidence.phone = haystack ? (haystack.replace(/\s/g, "").includes(draft.phone.replace(/\s/g, "")) ? 1 : 0.3) : 0.6; }
  if (draft.hours) {
    const stated = Object.keys(draft.hours) as Weekday[];
    const missing = WEEKDAYS.filter((d) => !stated.includes(d));
    partial.hours = Object.fromEntries(WEEKDAYS.map((d) => [d, draft.hours?.[d] ?? null])) as ShopConfig["hours"];
    if (missing.length) notes.push(`hours not stated for ${missing.join(",")}, set to closed`);
    confidence.hours = haystack ? hoursConfidence(haystack, draft.hours) : 0.6;
  }
  if (draft.sizeTiers) { partial.sizeTiers = draft.sizeTiers; confidence.sizeTiers = 0.7; }
  if (draft.notes) partial.policies = { quoteDisclaimer: { en: "", zh: "" }, notes: draft.notes };

  if (draft.services) {
    let verified = 0;
    const services: ShopConfig["services"] = [];
    for (const s of draft.services) {
      const numbersOk = haystack ? s.prices.every((p) => haystack.includes(String(p.min)) && haystack.includes(String(p.max))) : true;
      const evidenceOk = haystack ? containsLoosely(haystack, s.evidence) : true;
      if (!numbersOk || !evidenceOk) {
        notes.push(`service ${s.id}: evidence not found in source, dropped (evidence: "${s.evidence.slice(0, 80)}")`);
        continue;
      }
      verified++;
      services.push({ id: s.id, name: s.name, durationMin: s.durationMin ?? 60, prices: s.prices });
    }
    if (services.length) partial.services = services;
    confidence.services = draft.services.length ? verified / draft.services.length : 0;
  }

  return { source: input.source, partial, confidence, rawNotes: [...notes, ...draft.unsure.map((u) => `unsure: ${u}`)] };
}

function emptyDraft(source: ShopSource, notes: string[]): ShopDraft {
  return { source, partial: {}, confidence: {}, rawNotes: notes };
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[$,]/g, "").replace(/\s+/g, " ").trim();
}

function containsLoosely(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (n.length <= 12) return haystack.includes(n);
  // 片段长了允许模型截断或换行，取前 40 个字符比
  return haystack.includes(n.slice(0, 40));
}

function hoursConfidence(haystack: string, hours: Draft["hours"]): number {
  const times = Object.values(hours ?? {}).flatMap((h) => (h ? [h.open, h.close] : []));
  if (!times.length) return 0.5;
  const found = times.filter((t) => {
    const [hh] = t.split(":");
    const h = Number(hh);
    const h12 = h > 12 ? h - 12 : h;
    return haystack.includes(t) || haystack.includes(`${h12}am`) || haystack.includes(`${h12}pm`) || haystack.includes(`${h12} am`) || haystack.includes(`${h12} pm`) || haystack.includes(`${h12}:`);
  }).length;
  return found / times.length;
}
