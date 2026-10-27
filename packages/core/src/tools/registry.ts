import type { JsonValue, Static, TSchema, Tool } from "@earendil-works/pi-ai";
import type { ShopConfig } from "../shop/schema.js";
import type { BookingStore, CalendarPort } from "../booking/ports.js";
import type { Gateway } from "../llm/gateway.js";

/**
 * 工具权限分三档，agent 只拿得到前两档：
 *   read     纯查询，无副作用
 *   propose  产生一个待确认的东西（挂 pending 预约）
 *   write    真正改外部状态，只能由美容师端调用，永远不注册给模型
 */
export type ToolPermission = "read" | "propose" | "write";

export interface ToolContext {
  shop: ShopConfig;
  conversationId: string;
  channel: string;
  gateway: Gateway;
  calendar: CalendarPort;
  bookings: BookingStore;
  /** 本轮对话里客人发来的图片，按 id 取，identify_pet 用 */
  images: Map<string, { data: string; mimeType: string }>;
  locale: "en" | "zh";
}

export interface ToolOutcome {
  /** 给模型看的文本 */
  text: string;
  /** 结构化结果，进轨迹和 eval，不发给模型 */
  details?: JsonValue;
  isError?: boolean;
}

export interface ToolSpec<T extends TSchema = TSchema> {
  definition: Tool<T>;
  permission: Exclude<ToolPermission, "write">;
  run(args: Static<T>, ctx: ToolContext): Promise<ToolOutcome>;
}

export class ToolRegistry {
  private readonly specs = new Map<string, ToolSpec>();

  register<T extends TSchema>(spec: ToolSpec<T>): this {
    // 类型上已经排除了 write，但 JS 调用方绕得过类型，运行时再拦一次
    if ((spec.permission as ToolPermission) === "write") throw new Error(`write-level tool cannot be exposed to the agent: ${spec.definition.name}`);
    if (this.specs.has(spec.definition.name)) throw new Error(`tool already registered: ${spec.definition.name}`);
    this.specs.set(spec.definition.name, spec as unknown as ToolSpec);
    return this;
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.get(name);
  }

  definitions(): Tool[] {
    return [...this.specs.values()].map((s) => s.definition);
  }
}

export function defineTool<T extends TSchema>(spec: ToolSpec<T>): ToolSpec<T> {
  return spec;
}
