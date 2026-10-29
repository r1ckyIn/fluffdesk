import { findShopByChannel, LIMITS, type UserInput } from "@fluffdesk/core";
import type { Runtime } from "../runtime.js";
import { BoundedStore } from "../ratelimit.js";
import { handleInbound } from "./base.js";
import { fetchWhatsAppMedia, sendWhatsAppText, type MetaDeps } from "./meta.js";

/**
 * WhatsApp Cloud API 适配。webhook 的 payload 翻成一条条事件，每条：去重 → 按 phone_number_id 找店 →
 * 每会话限流 → 翻成 UserInput（文字直接用，图片经 Graph 拉下来）→ handleInbound → 回复发回去。
 * 验签在路由层做完才会进到这里。
 */
export interface WhatsAppEvent {
  phoneNumberId: string;
  from: string;
  messageId: string;
  /** text / image 之外的都算 unsupported，回一句固定话术，不调模型 */
  kind: "text" | "image" | "unsupported";
  text?: string;
  mediaId?: string;
}

const ID = /^[A-Za-z0-9_.:=+-]{1,256}$/;
const PHONE = /^\d{5,20}$/;

/** 只认 messages 事件；statuses（送达回执）和别的 field 忽略。字段缺失或形状不对的消息整条丢掉 */
export function parseWhatsAppPayload(payload: unknown): WhatsAppEvent[] {
  const out: WhatsAppEvent[] = [];
  const root = payload as { object?: unknown; entry?: unknown } | null;
  if (!root || typeof root !== "object" || root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return out;
  for (const entry of root.entry as Array<{ changes?: unknown } | null>) {
    if (!entry || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes as Array<{ field?: unknown; value?: unknown } | null>) {
      if (!change || change.field !== "messages" || !change.value || typeof change.value !== "object") continue;
      const value = change.value as { metadata?: { phone_number_id?: unknown }; messages?: unknown };
      const phoneNumberId = value.metadata?.phone_number_id;
      if (typeof phoneNumberId !== "string" || !ID.test(phoneNumberId) || !Array.isArray(value.messages)) continue;
      for (const m of value.messages as Array<Record<string, unknown> | null>) {
        if (!m || typeof m.id !== "string" || !ID.test(m.id) || typeof m.from !== "string" || !PHONE.test(m.from)) continue;
        const base = { phoneNumberId, from: m.from, messageId: m.id };
        if (m.type === "text") {
          const body = (m.text as { body?: unknown } | undefined)?.body;
          if (typeof body !== "string") continue;
          out.push({ ...base, kind: "text", text: body });
        } else if (m.type === "image") {
          const img = m.image as { id?: unknown; caption?: unknown } | undefined;
          if (typeof img?.id !== "string") continue;
          out.push({ ...base, kind: "image", mediaId: img.id, text: typeof img.caption === "string" ? img.caption : undefined });
        } else {
          out.push({ ...base, kind: "unsupported" });
        }
      }
    }
  }
  return out;
}

/** 不调模型的固定话术，双语，因为这时还不知道客人用哪种语言 */
export const CANNED = {
  unsupported: "I can only read text and photos here. Please send a message or a photo of your pet.\n这里只能看文字和照片，请发文字或宠物的照片。",
  mediaFailed: "I couldn't load that photo. Please try again with a smaller JPEG, PNG or WebP.\n这张照片没读出来，请换一张小一点的 JPEG、PNG 或 WebP 再发。",
  failed: "Sorry, something went wrong on our side. Please send that again in a moment, or the groomer will get back to you.\n抱歉，我们这边出了点问题。请稍后再发一次，或者等美容师回复您。",
} as const;

export interface WhatsAppChannel {
  /** 处理一整个 webhook payload。每条消息的错误各自记日志，不影响别的消息；返回时全部处理完 */
  handle(rt: Runtime, payload: unknown): Promise<void>;
}

/** 24 小时内见过的消息 id：Meta 没收到 200 会重发，模型不能对同一条消息跑两次 */
const SEEN_MAX = 10_000;
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

export function createWhatsAppChannel(config: Record<string, string | undefined>, deps: MetaDeps): WhatsAppChannel {
  const token = config.WHATSAPP_ACCESS_TOKEN ?? "";
  const seen = new BoundedStore<true>(SEEN_MAX, SEEN_TTL_MS);

  async function one(rt: Runtime, ev: WhatsAppEvent): Promise<void> {
    if (seen.get(ev.messageId)) return;
    seen.set(ev.messageId, true);
    const shop = await findShopByChannel(rt.shops, "whatsapp", ev.phoneNumberId);
    if (!shop) {
      console.warn(`[whatsapp] no shop bound to phone_number_id ${ev.phoneNumberId}, dropped`);
      return;
    }
    // 每个客人号码一个预算，超了直接丢，不回话：回话也算发消息，会被刷
    if (!rt.limits.perSession.take(`whatsapp:${ev.from}`)) return;
    const reply = (text: string) => sendWhatsAppText(deps, token, ev.phoneNumberId, ev.from, text);

    if (ev.kind === "unsupported") return reply(CANNED.unsupported);
    const text = (ev.text ?? "").replace(/\u0000/g, "").trim().slice(0, LIMITS.textChars);
    const images: NonNullable<UserInput["images"]> = [];
    if (ev.kind === "image") {
      const media = await fetchWhatsAppMedia(deps, token, ev.mediaId!);
      if ("error" in media) {
        console.warn(`[whatsapp] media ${ev.mediaId} skipped: ${media.error}`);
        // 照片没拿到、又没别的话，就只告诉客人重发；带了说明文字的照样让模型接着聊
        if (!text) return reply(CANNED.mediaFailed);
      } else {
        images.push(media);
      }
    }
    if (!text && images.length === 0) return;
    const result = await handleInbound(rt, { shop, channel: "whatsapp", externalId: ev.from, input: { text: text || undefined, images } });
    if (result.reply) await reply(result.reply);
  }

  return {
    async handle(rt, payload) {
      for (const ev of parseWhatsAppPayload(payload)) {
        try {
          await one(rt, ev);
        } catch (e) {
          // 库、模型或 Graph 抖一下不能变成静默丢消息：Meta 已经拿到 200 不会重发。
          // 把 id 从去重表里拿掉（人工重放或 Meta 的重试还能进来），再尽力告诉客人一声
          console.error(`[whatsapp] message ${ev.messageId} failed: ${(e as Error).message}`);
          seen.delete(ev.messageId);
          await sendWhatsAppText(deps, token, ev.phoneNumberId, ev.from, CANNED.failed).catch((e2: unknown) =>
            console.error(`[whatsapp] could not notify ${ev.messageId}: ${(e2 as Error).message}`),
          );
        }
      }
    },
  };
}
