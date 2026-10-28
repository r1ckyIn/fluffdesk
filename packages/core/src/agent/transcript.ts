import type { TextContent, ToolCall } from "@earendil-works/pi-ai";
import type { Conversation } from "./loop.js";

/**
 * 给美容师端看的会话记录：只有文字和图片 id，没有 base64、没有 system prompt、没有模型的 thinking。
 * 图片本体另走一个接口按 id 取。工具调用压成一行"工具名 + 结果文字"，美容师能看出 agent 报了什么价、查到了什么空档。
 */
export interface TranscriptEntry {
  role: "customer" | "agent" | "tool";
  text: string;
  /** 这条消息附的图片 id，只列还存着的 */
  imageIds?: string[];
  at?: number;
  tool?: { name: string; isError: boolean };
}

const IMAGE_MARKER = /^\[image (?:attached, imageId=(img_\d+)|omitted from history)\]$/;

export function transcript(conv: Conversation): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  const callNames = new Map<string, string>();
  for (const m of conv.messages) {
    if (m.role === "user") {
      const entry: TranscriptEntry = { role: "customer", text: "", at: m.timestamp };
      if (typeof m.content === "string") entry.text = m.content;
      else {
        const texts: string[] = [];
        const ids: string[] = [];
        for (const c of m.content) {
          if (c.type !== "text") continue;
          const marker = IMAGE_MARKER.exec(c.text);
          if (!marker) texts.push(c.text);
          else if (marker[1] && conv.images.has(marker[1])) ids.push(marker[1]);
        }
        entry.text = texts.join("\n");
        if (ids.length) entry.imageIds = ids;
      }
      if (entry.text || entry.imageIds) out.push(entry);
    } else if (m.role === "assistant") {
      const text = m.content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("\n").trim();
      for (const c of m.content) if (c.type === "toolCall") callNames.set(c.id, (c as ToolCall).name);
      if (text) out.push({ role: "agent", text, at: m.timestamp });
    } else if (m.role === "toolResult") {
      const text = m.content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("\n").trim();
      out.push({ role: "tool", text, at: m.timestamp, tool: { name: callNames.get(m.toolCallId) ?? m.toolName, isError: m.isError === true } });
    }
  }
  return out;
}
