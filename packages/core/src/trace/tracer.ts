/**
 * 对话轨迹。每次对话一条 trace，里面是按时间排的 span：
 * 模型调用、工具调用、整轮。属性名按 OpenTelemetry GenAI 语义约定，
 * 以后接任何 OTel 后端只需要写一个 sink，业务代码不动。
 */
export type SpanAttributes = Record<string, string | number | boolean | undefined>;

export interface Span {
  id: string;
  parentId?: string;
  name: string;
  startMs: number;
  endMs?: number;
  attributes: SpanAttributes;
  status: "ok" | "error";
  error?: string;
}

export interface Trace {
  id: string;
  conversationId: string;
  spans: Span[];
  /** 本次 trace 累计花费（美元）和 token，方便看板直接读 */
  totals: { costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export interface TraceSink {
  onTraceEnd(trace: Trace): void | Promise<void>;
}

export const ATTR = {
  operation: "gen_ai.operation.name",
  provider: "gen_ai.provider.name",
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  cacheReadTokens: "gen_ai.usage.cache_read.input_tokens",
  finishReason: "gen_ai.response.finish_reasons",
  toolName: "gen_ai.tool.name",
  toolCallId: "gen_ai.tool.call.id",
  conversationId: "gen_ai.conversation.id",
  costUsd: "fluffdesk.cost_usd",
  iteration: "fluffdesk.iteration",
  shop: "fluffdesk.shop",
  channel: "fluffdesk.channel",
} as const;

export class Tracer {
  readonly trace: Trace;
  private seq = 0;

  constructor(conversationId: string, private readonly sinks: TraceSink[] = []) {
    this.trace = {
      id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      spans: [],
      totals: { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    };
  }

  start(name: string, attributes: SpanAttributes = {}, parentId?: string): Span {
    const span: Span = {
      id: `sp_${++this.seq}`,
      parentId,
      name,
      startMs: Date.now(),
      attributes,
      status: "ok",
    };
    this.trace.spans.push(span);
    return span;
  }

  end(span: Span, extra: SpanAttributes = {}, error?: unknown): void {
    span.endMs = Date.now();
    Object.assign(span.attributes, extra);
    if (error) {
      span.status = "error";
      span.error = error instanceof Error ? error.message : String(error);
    }
    const t = this.trace.totals;
    t.costUsd += num(extra[ATTR.costUsd]);
    t.inputTokens += num(extra[ATTR.inputTokens]);
    t.outputTokens += num(extra[ATTR.outputTokens]);
    t.cacheReadTokens += num(extra[ATTR.cacheReadTokens]);
  }

  async finish(): Promise<Trace> {
    for (const sink of this.sinks) await sink.onTraceEnd(this.trace);
    return this.trace;
  }
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

/** 开发期用：把轨迹打到 stdout，一行一条 */
export const consoleTraceSink: TraceSink = {
  onTraceEnd(trace) {
    const t = trace.totals;
    console.log(
      `[trace ${trace.id}] conv=${trace.conversationId} spans=${trace.spans.length} ` +
        `in=${t.inputTokens} out=${t.outputTokens} cache=${t.cacheReadTokens} cost=$${t.costUsd.toFixed(4)}`,
    );
  },
};
