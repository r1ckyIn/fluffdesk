import { describe, expect, it } from "vitest";
import { Type, type Context } from "@earendil-works/pi-ai";
import { requestKey } from "../src/llm/replay.js";

/** 回放指纹的契约：凡是会改变模型回复的输入变了，指纹必须变，否则旧录制会给新提示词或新模型背书 */
const tool = { name: "quote", description: "Quote a price range. Always call this before mentioning any price.", parameters: Type.Object({ serviceId: Type.String() }) };
const base: Context = { systemPrompt: "You are the booking assistant.", tools: [tool], messages: [{ role: "user", content: "hi", timestamp: 0 }] };

describe("requestKey", () => {
  it("is stable for the same role, model, prompt, tools and messages regardless of timestamps", () => {
    const a = requestKey("chat", "anthropic/claude-sonnet-5-5", base);
    const b = requestKey("chat", "anthropic/claude-sonnet-5-5", { ...base, messages: [{ role: "user", content: "hi", timestamp: 999 }] });
    expect(a.key).toBe(b.key);
  });
  it("changes when the model changes", () => {
    expect(requestKey("chat", "anthropic/claude-sonnet-5-5", base).key).not.toBe(requestKey("chat", "deepseek/deepseek-v4-pro", base).key);
  });
  it("changes when a tool's description or schema changes, not only its name", () => {
    const k = requestKey("chat", "m", base).key;
    expect(requestKey("chat", "m", { ...base, tools: [{ ...tool, description: "Quote a price range." }] }).key).not.toBe(k);
    expect(requestKey("chat", "m", { ...base, tools: [{ ...tool, parameters: Type.Object({ serviceId: Type.String(), size: Type.String() }) }] }).key).not.toBe(k);
  });
  it("changes when the system prompt or a message changes", () => {
    const k = requestKey("chat", "m", base).key;
    expect(requestKey("chat", "m", { ...base, systemPrompt: "You are a different assistant." }).key).not.toBe(k);
    expect(requestKey("chat", "m", { ...base, messages: [{ role: "user", content: "hello", timestamp: 0 }] }).key).not.toBe(k);
  });
});
