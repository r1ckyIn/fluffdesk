/**
 * 公网进来的东西都要有上限。数值是产品决定，集中在这里，测试只断言"超了会拦"。
 */
export const LIMITS = {
  /** 一轮最多几张图 */
  imagesPerTurn: 3,
  /** 一个会话累计最多几张图（identify_pet 还能引用的） */
  imagesPerConversation: 8,
  /** 一张图 base64 最大字节数（约 1.5MB 原图） */
  imageBase64Bytes: 2_000_000,
  /** 一个会话最多多少条消息，超过就转人工，不再调模型 */
  messagesPerConversation: 80,
  /** 一个会话最多挂几个待确认预约 */
  pendingBookingsPerConversation: 2,
  /** 客人一条消息最长 */
  textChars: 2000,
  /** 历史里保留图片的最近几轮，更早的替换成文字占位，省 token */
  imageTurnsKept: 1,
} as const;

export const IMAGE_MIME_ALLOWLIST = new Set(["image/jpeg", "image/png", "image/webp"]);
