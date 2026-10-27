import {
  createModels,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

/**
 * 模型网关。业务代码只认"角色"，不认具体模型：
 *   chat     主对话 + 工具调用
 *   vision   识图（宠物品种、体型、毛况）
 *   judge    eval 里的模型评审
 *   fallback chat 出错时的降级
 * 角色到模型的映射来自环境变量 FLUFF_<ROLE>_MODEL=provider/model-id。
 */
export type ModelRole = "chat" | "vision" | "judge" | "fallback";

export interface GatewayCallOptions {
  sessionId?: string;
  reasoning?: "minimal" | "low" | "medium" | "high";
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface Gateway {
  readonly models: MutableModels;
  model(role: ModelRole): Model<Api>;
  complete(role: ModelRole, context: Context, options?: GatewayCallOptions): Promise<AssistantMessage>;
}

export interface GatewayInit {
  env?: Record<string, string | undefined>;
  /** 测试用：直接给角色塞模型对象（比如 faux），跳过环境变量 */
  roleModels?: Partial<Record<ModelRole, Model<Api>>>;
  models?: MutableModels;
}

const DEFAULT_ROLES: Record<ModelRole, string> = {
  chat: "anthropic/claude-sonnet-5-5",
  vision: "anthropic/claude-haiku-5-5",
  judge: "anthropic/claude-sonnet-5-5",
  fallback: "deepseek/deepseek-v4-pro",
};

export function createGateway(init: GatewayInit = {}): Gateway {
  const env = init.env ?? process.env;
  const models = init.models ?? defaultModels();

  const resolved: Partial<Record<ModelRole, Model<Api>>> = { ...init.roleModels };
  const model = (role: ModelRole): Model<Api> => {
    const cached = resolved[role];
    if (cached) return cached;
    const spec = env[`FLUFF_${role.toUpperCase()}_MODEL`] ?? DEFAULT_ROLES[role];
    const [provider, ...rest] = spec.split("/");
    const id = rest.join("/");
    const found = provider && id ? models.getModel(provider, id) : undefined;
    if (!found) throw new Error(`unknown model for role ${role}: ${spec}`);
    resolved[role] = found;
    return found;
  };

  return {
    models,
    model,
    async complete(role, context, options = {}) {
      const run = (m: Model<Api>) =>
        models.completeSimple(m, context, {
          sessionId: options.sessionId,
          reasoning: options.reasoning,
          maxTokens: options.maxTokens ?? 2048,
          signal: options.signal,
          cacheRetention: "short",
        });
      const first = await run(model(role));
      if (first.stopReason !== "error" || role === "fallback") return first;
      // 主模型出错一次，换降级模型重试一次；再错就原样返回给循环处理
      const fb = safeModel("fallback", model);
      if (!fb || fb === model(role)) return first;
      return run(fb);
    },
  };
}

function safeModel(role: ModelRole, model: Gateway["model"]): Model<Api> | undefined {
  try {
    return model(role);
  } catch {
    return undefined;
  }
}

/** 默认只注册我们真的会用的 provider，按需再加 */
export function defaultModels(): MutableModels {
  const models = createModels();
  models.setProvider(anthropicProvider());
  models.setProvider(deepseekProvider());
  return models;
}
