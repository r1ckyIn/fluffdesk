import { createHash } from "node:crypto";
import { createModels, fauxProvider, type AssistantMessage, type Context, type Message } from "@earendil-works/pi-ai";
import type { Gateway, GatewayCallOptions, ModelRole } from "./gateway.js";

/**
 * 录制回放。真模型跑一遍把每次回复按"请求指纹"存下来，CI 里按指纹回放：
 * 同样的输入拿到同样的回复，不花钱、确定性；请求对不上指纹就直接失败，说明提示词或工具变了，
 * 必须重新录制。这是 e2e 测试用真实模型输出而不是手写脚本的办法。
 */
export interface Recording {
  key: string;
  role: ModelRole;
  /** 调试用：指纹是从哪些内容算出来的（截断） */
  summary: string;
  /** 完整的指纹输入，回放对不上时用来逐段比对 */
  request: string[];
  response: AssistantMessage;
}

/** 指纹只看会影响模型回复的内容：角色、系统提示、工具名、每条消息的文本和图片摘要。时间戳不算 */
export function requestKey(role: ModelRole, context: Context): { key: string; summary: string; parts: string[] } {
  const parts: string[] = [role, context.systemPrompt ?? "", (context.tools ?? []).map((t) => t.name).join(",")];
  for (const m of context.messages) parts.push(messageDigest(m));
  const summary = parts.slice(3).join(" | ").slice(0, 200);
  return { key: createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 16), summary, parts };
}

function messageDigest(m: Message): string {
  if (m.role === "user" || m.role === "toolResult") {
    if (typeof m.content === "string") return `${m.role}:${m.content}`;
    return `${m.role}:` + m.content.map((c) => (c.type === "text" ? c.text : `[img ${createHash("sha1").update(c.data).digest("hex").slice(0, 8)}]`)).join("");
  }
  if (m.role === "assistant") {
    return "assistant:" + m.content.map((c) => (c.type === "text" ? c.text : c.type === "toolCall" ? `${c.name}(${JSON.stringify(c.arguments)})` : "")).join("");
  }
  return `${m.role}:${typeof m.content === "string" ? m.content : ""}`;
}

/** 包一层：真模型照常跑，每次回复交给 sink */
export function recordingGateway(inner: Gateway, sink: (rec: Recording) => void): Gateway {
  return {
    models: inner.models,
    model: inner.model,
    async complete(role, context, options) {
      const response = await inner.complete(role, context, options);
      const { key, summary, parts } = requestKey(role, context);
      sink({ key, role, summary, request: parts, response });
      return response;
    },
  };
}

export class ReplayMissError extends Error {
  constructor(role: ModelRole, key: string, summary: string, diff?: string) {
    super(`no recording for ${role} request ${key}: ${summary}\n${diff ?? ""}Prompt, tools or inputs changed; re-record with --record.`);
  }
}

/** 找最像的一条录制，报告第一处不同的段，省得人肉比对 */
function nearestDiff(parts: string[], recordings: Recording[]): string | undefined {
  let best: { rec: Recording; idx: number } | undefined;
  for (const rec of recordings) {
    if (!rec.request || rec.request.length !== parts.length) continue;
    const idx = rec.request.findIndex((p, i) => p !== parts[i]);
    if (!best || idx > best.idx) best = { rec, idx };
  }
  if (!best || best.idx < 0) return undefined;
  const label = ["role", "systemPrompt", "tools"][best.idx] ?? `message[${best.idx - 3}]`;
  return `closest recording ${best.rec.key} differs at ${label}:\n  recorded: ${best.rec.request[best.idx]?.slice(0, 300)}\n  now:      ${parts[best.idx]?.slice(0, 300)}\n`;
}

/** 只认录制过的请求。同一指纹录了多条时按顺序消费 */
export function replayGateway(recordings: Recording[]): Gateway {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const m = faux.getModel();
  const queue = new Map<string, Recording[]>();
  for (const r of recordings) queue.set(r.key, [...(queue.get(r.key) ?? []), r]);
  return {
    models,
    model: () => m,
    async complete(role: ModelRole, context: Context, _options?: GatewayCallOptions) {
      const { key, summary, parts } = requestKey(role, context);
      const hits = queue.get(key);
      const rec = hits?.shift();
      if (!rec) throw new ReplayMissError(role, key, summary, nearestDiff(parts, recordings));
      return structuredClone(rec.response);
    },
  };
}
