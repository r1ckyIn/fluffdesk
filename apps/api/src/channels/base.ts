import { conversationKey, runTurn, type TurnResult, type UserInput } from "@fluffdesk/core";
import type { Runtime } from "../runtime.js";
import { withSessionLock } from "../session-lock.js";

/**
 * 所有渠道的共同部分：找到或新建会话，跑一轮，存回去，返回回复。
 * 渠道适配层只做两件事：把渠道消息翻译成 UserInput，把 reply 送回渠道。
 */
export interface InboundMessage {
  shopSlug: string;
  channel: "web" | "embed" | "instagram" | "whatsapp" | string;
  /** 渠道侧会话标识 */
  externalId: string;
  locale?: "en" | "zh";
  input: UserInput;
}

export async function handleInbound(rt: Runtime, msg: InboundMessage): Promise<TurnResult> {
  const shop = await rt.shops.get(msg.shopSlug);
  if (!shop) throw new Error(`unknown shop ${msg.shopSlug}`);
  const key = { shopSlug: shop.slug, channel: msg.channel, externalId: msg.externalId };
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
