import { findShopByChannel, LIMITS, type ShopChannels, type UserInput } from "@fluffdesk/core";
import type { Runtime } from "../runtime.js";
import { BoundedStore } from "../ratelimit.js";
import { handleInbound } from "./base.js";

/**
 * Meta 两个渠道共用的入站流水线：去重 → 按店侧账号 id 找店 → 每客人限流 → 拉图 → 跑模型 → 回复，
 * 外加两种失败兜底（存前失败删去重 id 并告诉客人；存后发送失败只补一句、id 留着）。
 * 渠道自己只做三件事：把 payload 翻成事件、发文字、按自己的方式取图片字节。验签在路由层。
 */
export interface InboundEvent {
  /** 店侧账号 id：WhatsApp 的 phone_number_id、Instagram 的专业账号 id */
  accountId: string;
  /** 客人侧 id：WhatsApp 号码、Instagram 的 IGSID。做会话 externalId 和限流键 */
  from: string;
  messageId: string;
  /** text / image 之外的都算 unsupported，回一句固定话术，不调模型 */
  kind: "text" | "image" | "unsupported";
  text?: string;
}

export type ImageFetch = { data: string; mimeType: string } | { error: "type" | "size" | "fetch" };

export interface MetaChannelSpec<E extends InboundEvent> {
  channel: keyof ShopChannels;
  parse(payload: unknown): E[];
  send(ev: E, text: string): Promise<void>;
  /** kind === "image" 时取图；每个失败各自记日志，取到的按顺序进模型 */
  fetchImages(ev: E): Promise<ImageFetch[]>;
}

export interface MetaChannel {
  /** 处理一整个 webhook payload。每条消息的错误各自记日志，不影响别的消息；返回时全部处理完 */
  handle(rt: Runtime, payload: unknown): Promise<void>;
}

/** 不调模型的固定话术，双语，因为这时还不知道客人用哪种语言 */
export const CANNED = {
  unsupported: "I can only read text and photos here. Please send a message or a photo of your pet.\n这里只能看文字和照片，请发文字或宠物的照片。",
  mediaFailed: "I couldn't load that photo. Please try again with a smaller JPEG, PNG or WebP.\n这张照片没读出来，请换一张小一点的 JPEG、PNG 或 WebP 再发。",
  failed: "Sorry, something went wrong on our side. Please send that again in a moment, or the groomer will get back to you.\n抱歉，我们这边出了点问题。请稍后再发一次，或者等美容师回复您。",
} as const;

/** 24 小时内见过的消息 id：Meta 没收到 200 会重发，模型不能对同一条消息跑两次 */
const SEEN_MAX = 10_000;
const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

export function createMetaChannel<E extends InboundEvent>(spec: MetaChannelSpec<E>): MetaChannel {
  const tag = `[${spec.channel}]`;
  const seen = new BoundedStore<true>(SEEN_MAX, SEEN_TTL_MS);

  async function one(rt: Runtime, ev: E): Promise<void> {
    if (seen.get(ev.messageId)) return;
    seen.set(ev.messageId, true);
    const shop = await findShopByChannel(rt.shops, spec.channel, ev.accountId);
    if (!shop) {
      console.warn(`${tag} no shop bound to account ${ev.accountId}, dropped`);
      return;
    }
    // 每个客人一个预算，超了直接丢，不回话：回话也算发消息，会被刷
    if (!rt.limits.perSession.take(`${spec.channel}:${ev.from}`)) return;
    const reply = (text: string) => spec.send(ev, text);

    if (ev.kind === "unsupported") return reply(CANNED.unsupported);
    const text = (ev.text ?? "").replace(/\u0000/g, "").trim().slice(0, LIMITS.textChars);
    const images: NonNullable<UserInput["images"]> = [];
    if (ev.kind === "image") {
      for (const got of await spec.fetchImages(ev)) {
        if ("error" in got) console.warn(`${tag} image of ${ev.messageId} skipped: ${got.error}`);
        else images.push(got);
      }
      // 照片一张都没拿到、又没别的话，就只告诉客人重发；带了说明文字的照样让模型接着聊
      if (images.length === 0 && !text) return reply(CANNED.mediaFailed);
    }
    if (!text && images.length === 0) return;
    const result = await handleInbound(rt, { shop, channel: spec.channel, externalId: ev.from, input: { text: text || undefined, images } });
    if (!result.reply) return;
    try {
      await reply(result.reply);
    } catch (e) {
      // 轮次已经存了，只是回复没发出去：id 留在去重表里（重放不能再跑一次模型），尽力告诉客人
      console.error(`${tag} reply for ${ev.messageId} not delivered: ${(e as Error).message}`);
      await reply(CANNED.failed).catch((e2: unknown) => console.error(`${tag} could not notify ${ev.messageId}: ${(e2 as Error).message}`));
    }
  }

  return {
    async handle(rt, payload) {
      for (const ev of spec.parse(payload)) {
        try {
          await one(rt, ev);
        } catch (e) {
          // 到这里的都是轮次存下来之前的失败（找店、拉图、模型、存库）：Meta 已经拿到 200 不会重发，不能静默丢。
          // 把 id 从去重表里拿掉（人工重放或 Meta 的重试还能进来），再尽力告诉客人一声
          console.error(`${tag} message ${ev.messageId} failed: ${(e as Error).message}`);
          seen.delete(ev.messageId);
          await spec.send(ev, CANNED.failed).catch((e2: unknown) => console.error(`${tag} could not notify ${ev.messageId}: ${(e2 as Error).message}`));
        }
      }
    },
  };
}
