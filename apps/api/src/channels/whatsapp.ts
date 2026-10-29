import { createMetaChannel, type InboundEvent, type MetaChannel } from "./inbound.js";
import { fetchWhatsAppMedia, sendWhatsAppText, type MetaDeps } from "./meta.js";

export { CANNED } from "./inbound.js";

/**
 * WhatsApp Cloud API 适配：把 webhook payload 翻成事件，发文字，图片经 Graph 两步拉取。
 * 流水线（去重、找店、限流、兜底）在 inbound.ts，验签在路由层。
 */
export interface WhatsAppEvent extends InboundEvent {
  /** = accountId，留着给读代码的人对照 Meta 文档的字段名 */
  phoneNumberId: string;
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
        const base = { accountId: phoneNumberId, phoneNumberId, from: m.from, messageId: m.id };
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

export function createWhatsAppChannel(config: Record<string, string | undefined>, deps: MetaDeps): MetaChannel {
  const token = config.WHATSAPP_ACCESS_TOKEN ?? "";
  return createMetaChannel<WhatsAppEvent>({
    channel: "whatsapp",
    parse: parseWhatsAppPayload,
    send: (ev, text) => sendWhatsAppText(deps, token, ev.phoneNumberId, ev.from, text),
    fetchImages: async (ev) => [await fetchWhatsAppMedia(deps, token, ev.mediaId!)],
  });
}
