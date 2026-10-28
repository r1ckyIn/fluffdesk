import { conversationKey, runTurn, type ShopConfig, type TurnResult, type UserInput } from "@fluffdesk/core";
import type { Runtime } from "../runtime.js";
import { withSessionLock } from "../session-lock.js";

/**
 * 所有渠道的共同部分：找到或新建会话，跑一轮，存回去，返回回复。
 * 渠道适配层只做两件事：把渠道消息翻译成 UserInput，把 reply 送回渠道。
 */
export interface InboundMessage {
  /** 路由层已经查过并确认存在的店，这里不再查一次 */
  shop: ShopConfig;
  channel: "web" | "embed" | "instagram" | "whatsapp" | string;
  /** 渠道侧会话标识 */
  externalId: string;
  locale?: "en" | "zh";
  input: UserInput;
}

export async function handleInbound(rt: Runtime, msg: InboundMessage): Promise<TurnResult> {
  const { shop } = msg;
  const key = { shopSlug: shop.slug, channel: msg.channel, externalId: msg.externalId };
  // runTurn 抛出来（模型角色没配、工具上下文坏了）就不 save：半截轮次不落库，下一条消息从上一轮完整状态开始
  return withSessionLock(conversationKey(key), async () => {
    const conv = await rt.conversations.findOrCreate(key, msg.locale ?? detectLocale(msg.input.text));
    const result = await runTurn(
      {
        gateway: rt.gateway,
        shop,
        tools: rt.tools,
        toolContext: { bookings: rt.bookings, calendar: rt.calendarFor(shop) },
        tracer: rt.newTracer(conv.id),
      },
      conv,
      msg.input,
    );
    await rt.conversations.save(conv);
    return result;
  });
}

export function detectLocale(text?: string): "en" | "zh" {
  return text && /[一-鿿]/.test(text) ? "zh" : "en";
}
