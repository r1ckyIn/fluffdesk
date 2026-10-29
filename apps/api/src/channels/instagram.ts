/**
 * Instagram Messaging API 适配。
 * TODO: 验签复用 channels/meta.ts 的 verifyMetaSignature（META_APP_SECRET）、把 messaging event 翻成 InboundMessage、用 Graph API 回消息。
 */
export const instagramChannel = { name: "instagram" as const };
