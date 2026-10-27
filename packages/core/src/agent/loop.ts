import { validateToolCall, type Context, type ImageContent, type Message, type TextContent, type ToolCall } from "@earendil-works/pi-ai";
import type { Gateway } from "../llm/gateway.js";
import type { ShopConfig } from "../shop/schema.js";
import type { ToolContext, ToolRegistry } from "../tools/registry.js";
import { ATTR, Tracer } from "../trace/tracer.js";
import { buildSystemPrompt } from "./prompt.js";
import { IMAGE_MIME_ALLOWLIST, LIMITS } from "./limits.js";

/**
 * agent 循环。自己写的原因：要控制停止条件、每步的权限检查和轨迹，
 * 这些是产品规则，不交给框架。
 *
 * 一轮 = 客人一条消息进来，到 agent 给出一条回复。中间可能有多次模型调用和工具调用，
 * 上限 maxIterations，到顶就停下来转人工。
 */
export interface Conversation {
  id: string;
  shopSlug: string;
  channel: string;
  locale: "en" | "zh";
  messages: Message[];
  images: Map<string, { data: string; mimeType: string }>;
}

export interface UserInput {
  text?: string;
  images?: Array<{ data: string; mimeType: string }>;
}

export interface TurnResult {
  reply: string;
  stop: "done" | "max_iterations" | "error" | "limit";
  toolCalls: Array<{ name: string; args: unknown; outcomeText: string; isError: boolean; details?: unknown }>;
  traceId: string;
  costUsd: number;
}

export interface AgentDeps {
  gateway: Gateway;
  shop: ShopConfig;
  tools: ToolRegistry;
  toolContext: Omit<ToolContext, "shop" | "conversationId" | "channel" | "gateway" | "images" | "locale">;
  tracer?: Tracer;
  maxIterations?: number;
  /** 测试里固定日期用 */
  today?: () => string;
}

export function newConversation(init: Pick<Conversation, "id" | "shopSlug" | "channel" | "locale">): Conversation {
  return { ...init, messages: [], images: new Map() };
}

const HANDOFF: Record<"en" | "zh", string> = {
  en: "Let me pass this to the groomer, they will get back to you shortly.",
  zh: "这个我帮您转给美容师，稍后给您回复。",
};

export async function runTurn(deps: AgentDeps, conv: Conversation, input: UserInput): Promise<TurnResult> {
  const tracer = deps.tracer ?? new Tracer(conv.id);
  const maxIterations = deps.maxIterations ?? 8;
  const turnSpan = tracer.start("agent.turn", { [ATTR.conversationId]: conv.id, [ATTR.shop]: deps.shop.slug, [ATTR.channel]: conv.channel });

  // 会话太长就不再调模型，直接转人工。公网会话不能无限长
  if (conv.messages.length >= LIMITS.messagesPerConversation) {
    tracer.end(turnSpan, {}, "conversation message limit");
    await tracer.finish();
    return { reply: HANDOFF[conv.locale], stop: "limit", toolCalls: [], traceId: tracer.trace.id, costUsd: 0 };
  }

  const content: Array<TextContent | ImageContent> = [];
  if (input.text) content.push({ type: "text", text: input.text.slice(0, LIMITS.textChars) });
  const accepted = (input.images ?? [])
    .filter((img) => IMAGE_MIME_ALLOWLIST.has(img.mimeType) && img.data.length <= LIMITS.imageBase64Bytes)
    .slice(0, Math.max(0, Math.min(LIMITS.imagesPerTurn, LIMITS.imagesPerConversation - conv.images.size)));
  for (const img of accepted) {
    const id = `img_${conv.images.size + 1}`;
    conv.images.set(id, img);
    content.push({ type: "text", text: `[image attached, imageId=${id}]` });
    content.push({ type: "image", data: img.data, mimeType: img.mimeType });
  }
  if (content.length === 0) content.push({ type: "text", text: "[empty message]" });
  pruneOldImages(conv.messages, LIMITS.imageTurnsKept);
  conv.messages.push({ role: "user", content, timestamp: Date.now() });

  const toolCtx: ToolContext = {
    ...deps.toolContext,
    shop: deps.shop,
    conversationId: conv.id,
    channel: conv.channel,
    gateway: deps.gateway,
    images: conv.images,
    locale: conv.locale,
  };
  const tools = deps.tools.definitions();
  const result: TurnResult = { reply: "", stop: "done", toolCalls: [], traceId: tracer.trace.id, costUsd: 0 };

  try {
    for (let i = 0; i < maxIterations; i++) {
      const context: Context = {
        systemPrompt: buildSystemPrompt(deps.shop, (deps.today ?? todayInTz(deps.shop.timezone))()),
        messages: conv.messages,
        tools,
      };
      const span = tracer.start("chat", { [ATTR.operation]: "chat", [ATTR.iteration]: i }, turnSpan.id);
      const msg = await deps.gateway.complete("chat", context, { sessionId: conv.id, reasoning: "low" });
      tracer.end(span, {
        [ATTR.provider]: msg.provider,
        [ATTR.requestModel]: msg.model,
        [ATTR.finishReason]: msg.stopReason,
        [ATTR.inputTokens]: msg.usage.input,
        [ATTR.outputTokens]: msg.usage.output,
        [ATTR.cacheReadTokens]: msg.usage.cacheRead,
        [ATTR.costUsd]: msg.usage.cost.total,
      }, msg.stopReason === "error" ? msg.errorMessage : undefined);

      if (msg.stopReason === "error") {
        result.stop = "error";
        result.reply = HANDOFF[conv.locale];
        break;
      }
      conv.messages.push(msg);

      const calls = msg.content.filter((b): b is ToolCall => b.type === "toolCall");
      if (msg.stopReason !== "toolUse" || calls.length === 0) {
        result.reply = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        if (!result.reply) result.reply = HANDOFF[conv.locale];
        break;
      }

      for (const call of calls) {
        const outcome = await executeTool(call, tools, deps.tools, toolCtx, tracer, span.id);
        result.toolCalls.push({ name: call.name, args: call.arguments, outcomeText: outcome.text, isError: outcome.isError === true, details: outcome.details });
        conv.messages.push({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: [{ type: "text", text: outcome.text }],
          details: outcome.details,
          isError: outcome.isError === true,
          timestamp: Date.now(),
        });
      }
      if (i === maxIterations - 1) {
        result.stop = "max_iterations";
        result.reply = HANDOFF[conv.locale];
      }
    }
  } finally {
    tracer.end(turnSpan);
    const trace = await tracer.finish();
    result.costUsd = trace.totals.costUsd;
  }
  return result;
}

async function executeTool(
  call: ToolCall,
  defs: Context["tools"] & object,
  registry: ToolRegistry,
  ctx: ToolContext,
  tracer: Tracer,
  parentId: string,
) {
  const span = tracer.start("execute_tool", { [ATTR.operation]: "execute_tool", [ATTR.toolName]: call.name, [ATTR.toolCallId]: call.id }, parentId);
  const spec = registry.get(call.name);
  if (!spec) {
    tracer.end(span, {}, "unknown tool");
    return { text: `unknown tool ${call.name}`, isError: true };
  }
  try {
    const args = validateToolCall(defs, call);
    const outcome = await spec.run(args, ctx);
    tracer.end(span, { "fluffdesk.tool.permission": spec.permission }, outcome.isError ? outcome.text : undefined);
    return outcome;
  } catch (e) {
    tracer.end(span, {}, e);
    return { text: `tool error: ${(e as Error).message}`, isError: true };
  }
}

/** 只保留最近 keep 轮用户消息里的图片，更早的换成文字占位。每轮都把全部历史发给模型，图片最贵 */
export function pruneOldImages(messages: Message[], keep: number): void {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user" || typeof m.content === "string") continue;
    if (!m.content.some((c) => c.type === "image")) continue;
    if (seen++ < keep) continue;
    m.content = m.content.map((c) => (c.type === "image" ? { type: "text", text: "[image omitted from history]" } : c));
  }
}

function todayInTz(tz: string): () => string {
  return () => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
