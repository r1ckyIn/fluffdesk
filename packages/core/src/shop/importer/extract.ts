import { Type, validateToolCall, type Context, type ImageContent, type Message, type Static, type TextContent, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import type { Gateway } from "../../llm/gateway.js";
import { DayHours, I18nText, PriceRule, SizeTier, WEEKDAYS, Weekday, type ShopConfig, type ShopSource } from "../schema.js";
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
const MAX_OUTPUT_TOKENS = 12_000;

export const DEFAULT_QUOTE_DISCLAIMER = {
  en: "Final price is assessed in store based on size, coat condition and behaviour.",
  zh: "最终价格以到店评估体型、毛况和配合程度为准。",
};

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
    const res = await gateway.complete("chat", context, { maxTokens: MAX_OUTPUT_TOKENS, reasoning: "low" });
    if (res.stopReason === "error") {
      notes.push(`attempt ${attempt}: model error ${res.errorMessage ?? ""}`);
      continue;
    }
    if (res.stopReason === "length") {
      // 输出被截断，原样重试没有意义，直接放弃并说明原因
      notes.push(`attempt ${attempt}: output truncated at ${MAX_OUTPUT_TOKENS} tokens; source too large, split it`);
      break;
    }
    messages.push(res);
    const calls = res.content.filter((b): b is ToolCall => b.type === "toolCall");
    const call = calls.find((c) => c.name === submitDraftTool.name);
    // 每个 toolCall 都要有 toolResult，否则下一次请求会被 provider 拒掉，白烧重试次数
    const answerOthers = (reason: string) => {
      for (const other of calls) {
        if (other === call) continue;
        messages.push({ role: "toolResult", toolCallId: other.id, toolName: other.name, content: [{ type: "text", text: reason }], isError: true, timestamp: Date.now() });
      }
    };
    if (!call) {
      notes.push(`attempt ${attempt}: no tool call`);
      answerOthers("Unknown tool. Call submit_shop_draft instead.");
      messages.push({ role: "user", content: "Call submit_shop_draft with what you found.", timestamp: Date.now() });
      continue;
    }
    let draft: Draft;
    try {
      draft = validateToolCall([submitDraftTool], call) as Draft;
    } catch (e) {
      notes.push(`attempt ${attempt}: invalid draft: ${(e as Error).message}`);
      answerOthers("Ignored: only one submit_shop_draft call is accepted.");
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
    if (missing.length) notes.push(`hours not stated for ${missing.join(",")}, set to closed; confirm with the shop`);
    // 没说的天算不确定：置信度按"说了几天"打折，部分抽取不能得满分
    const verified = haystack ? hoursConfidence(haystack, draft.hours) : 0.6;
    confidence.hours = Math.min(verified, stated.length / WEEKDAYS.length);
  }
  if (draft.sizeTiers) { partial.sizeTiers = draft.sizeTiers; confidence.sizeTiers = 0.7; }
  if (draft.notes) {
    // 免责声明永远不能为空：先放默认文案，标低置信度让美容师确认
    partial.policies = { quoteDisclaimer: DEFAULT_QUOTE_DISCLAIMER, notes: draft.notes };
    confidence.policies = 0.5;
    notes.push("policies.quoteDisclaimer is the default text, confirm with the shop");
  }

  if (draft.services) {
    let verified = 0;
    let missingDuration = 0;
    const services: ShopConfig["services"] = [];
    for (const s of draft.services) {
      // 有原文时：先用 evidence 在原文里定位到一段，每个价格数字都得在那一段里（整数匹配，12 不算 120）。
      // 不能在整页里找数字：电话号码里的 55 会让一个编出来的 $55 通过；
      // 也不能只核 evidence 字符串本身：模型可以抄 40 个字原文再接一个编的价格。
      // 只有图片时没有原文可核，evidence 是模型自己写的，核了也没意义，靠置信度封顶表达不确定
      const spans = haystack === undefined ? [] : locateEvidence(haystack, s.evidence);
      const backed = !haystack || spans.some((span) => s.prices.every((p) => hasNumber(span, p.min) && hasNumber(span, p.max)));
      if (!backed) {
        notes.push(`service ${s.id}: prices not backed by evidence in source, dropped (evidence: "${s.evidence.slice(0, 80)}")`);
        continue;
      }
      verified++;
      if (s.durationMin === undefined) {
        missingDuration++;
        notes.push(`service ${s.id}: duration not stated, placeholder 60 min, confirm with the shop`);
      }
      services.push({ id: s.id, name: s.name, durationMin: s.durationMin ?? 60, prices: s.prices });
    }
    if (services.length) partial.services = services;
    confidence.services = draft.services.length ? verified / draft.services.length : 0;
    if (missingDuration) confidence.services = Math.min(confidence.services, 0.7);
    if (!haystack && services.length) notes.push("prices read from images, not verified against text; confirm with the shop");
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
  return locateEvidence(haystack, needle).length > 0;
}

/**
 * 用 evidence 在原文里定位，返回它可能对应的每一段原文。
 * 片段长了允许模型截断或换行，所以按前 40 个字符定位，再往后多取一截兜住 evidence 的余下部分。
 * 同一个前缀在页面上常出现多次（导航菜单、标题、再到价目表），只看第一处会把真服务漏掉，所以全部返回
 */
function locateEvidence(haystack: string, needle: string): string[] {
  const n = normalize(needle);
  if (!n) return [];
  const prefix = n.length <= 12 ? n : n.slice(0, 40);
  const spans: string[] = [];
  for (let idx = haystack.indexOf(prefix); idx !== -1 && spans.length < 20; idx = haystack.indexOf(prefix, idx + 1)) {
    spans.push(haystack.slice(idx, idx + Math.max(n.length, prefix.length) + 80));
  }
  return spans;
}

/** 整数匹配：120 不能靠 "1200" 或 "$12" 过；120.00 算 */
function hasNumber(text: string, n: number): boolean {
  return new RegExp(`(?<![\\d.])${String(n).replace(".", "\\.")}(?:\\.0+)?(?!\\d)`).test(text);
}

function hoursConfidence(haystack: string, hours: Draft["hours"]): number {
  const times = Object.values(hours ?? {}).flatMap((h) => (h ? [h.open, h.close] : []));
  if (!times.length) return 0.5;
  const found = times.filter((t) => {
    const [hh, mm = "00"] = t.split(":");
    const h = Number(hh);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    // 原文里可能写 09:00、9:00、9am、9.30am、9:30 pm。裸的 "9:" 不算：电话号码和比分里到处都是
    const minutes = mm === "00" ? "(?:[:.]00)?" : `[:.]${mm}`;
    const re = new RegExp(`(?<!\\d)(?:0?${h}:${mm}|${h12}${minutes} ?(?:am|pm))(?!\\d)`);
    return re.test(haystack);
  }).length;
  return found / times.length;
}
