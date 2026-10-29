import { LIMITS } from "@fluffdesk/core";
import { createMetaChannel, type InboundEvent, type MetaChannel } from "./inbound.js";
import { fetchInstagramImage, sendInstagramText, type MetaDeps } from "./meta.js";

/**
 * Instagram Messaging API 适配（Instagram Login 路线：webhook `object: "instagram"`，发送走 graph.instagram.com）。
 * 和 WhatsApp 的差别：客人侧是 IGSID，店侧是专业账号 id（entry.id），附件是 CDN 直链不用两步拉，文字上限按字节算。
 * 流水线（去重、找店、限流、兜底）在 inbound.ts，验签在路由层。
 */
export interface InstagramEvent extends InboundEvent {
  /** 要取的图片 URL（已限到每轮上限） */
  imageUrls?: string[];
}

const ACCOUNT_ID = /^\d{1,32}$/;
const MID = /^[A-Za-z0-9_.:=+/-]{1,512}$/;
/** 客人的被动动作：快捷表情、提到店的 story、分享帖子。既不是询价也不该被"只看文字和照片"说教，直接忽略 */
const PASSIVE_ATTACHMENTS = new Set(["like_heart", "story_mention", "share", "reel", "ig_reel", "story"]);

/**
 * 只认带 message 的 messaging 事件；read / reaction / postback 忽略；is_echo（自己发的）和 is_deleted 忽略。
 * Instagram Login 的形状是 entry[].messaging[]；Unified Login 文档说包在 entry[].changes[].value 里（未用真账号验过），同样认
 */
export function parseInstagramPayload(payload: unknown): InstagramEvent[] {
  const out: InstagramEvent[] = [];
  const root = payload as { object?: unknown; entry?: unknown } | null;
  if (!root || typeof root !== "object" || root.object !== "instagram" || !Array.isArray(root.entry)) return out;
  for (const entry of root.entry as Array<{ id?: unknown; messaging?: unknown; changes?: unknown } | null>) {
    if (!entry || typeof entry.id !== "string" || !ACCOUNT_ID.test(entry.id)) continue;
    const items: unknown[] = [];
    if (Array.isArray(entry.messaging)) items.push(...entry.messaging);
    if (Array.isArray(entry.changes)) {
      for (const c of entry.changes as Array<{ field?: unknown; value?: unknown } | null>) if (c?.field === "messages" && c.value) items.push(c.value);
    }
    for (const raw of items) {
      const item = raw as { sender?: { id?: unknown }; message?: Record<string, unknown> } | null;
      const msg = item?.message;
      const from = item?.sender?.id;
      if (!msg || typeof msg !== "object" || typeof from !== "string" || !ACCOUNT_ID.test(from)) continue;
      if (msg.is_echo === true || msg.is_deleted === true) continue;
      // 店自己发的消息不一定带 is_echo（没订阅 message_echoes 的应用）：发件人就是店账号的一律不当客人
      if (from === entry.id) continue;
      if (typeof msg.mid !== "string" || !MID.test(msg.mid)) continue;
      const base = { accountId: entry.id, from, messageId: msg.mid };
      const text = typeof msg.text === "string" ? msg.text : undefined;
      const attachments = Array.isArray(msg.attachments) ? (msg.attachments as Array<{ type?: unknown; payload?: { url?: unknown } } | null>) : [];
      const imageUrls = attachments
        .filter((a) => a?.type === "image" && typeof a.payload?.url === "string")
        .map((a) => a!.payload!.url as string)
        .slice(0, LIMITS.imagesPerTurn);
      const passiveOnly = attachments.length > 0 && attachments.every((a) => typeof a?.type === "string" && PASSIVE_ATTACHMENTS.has(a.type));
      if (imageUrls.length > 0) out.push({ ...base, kind: "image", imageUrls, text });
      else if (passiveOnly && !text) continue;
      else if (msg.is_unsupported === true || (attachments.length > 0 && !text)) out.push({ ...base, kind: "unsupported" });
      else if (text) out.push({ ...base, kind: "text", text });
    }
  }
  return out;
}

export function createInstagramChannel(config: Record<string, string | undefined>, deps: MetaDeps): MetaChannel {
  const token = config.INSTAGRAM_ACCESS_TOKEN ?? "";
  return createMetaChannel<InstagramEvent>({
    channel: "instagram",
    parse: parseInstagramPayload,
    send: (ev, text) => sendInstagramText(deps, token, ev.from, text),
    fetchImages: (ev) => Promise.all((ev.imageUrls ?? []).map((url) => fetchInstagramImage(deps, url))),
  });
}
