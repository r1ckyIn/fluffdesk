import { createHmac, timingSafeEqual } from "node:crypto";
import { IMAGE_MIME_ALLOWLIST, LIMITS, safeFetchBytes } from "@fluffdesk/core";

/**
 * Instagram 和 WhatsApp 共用的 Meta 这一层：webhook 验签、Graph API 发消息、拉媒体。
 * 两个产品挂在同一个 Meta 应用下，所以 App Secret 只有一个（META_APP_SECRET）。
 * 网络访问都从 deps 注入，测试里换成假的 fetch，不出网。
 */
export interface MetaDeps {
  fetch: typeof globalThis.fetch;
  /** 媒体 URL 的 DNS 解析，SSRF 护栏用；测试里固定成公网地址 */
  lookup?: (host: string) => Promise<string[]>;
  graphBase: string;
}

export function metaDeps(config: Record<string, string | undefined>, overrides: Partial<MetaDeps> = {}): MetaDeps {
  return {
    fetch: overrides.fetch ?? globalThis.fetch,
    lookup: overrides.lookup,
    graphBase: overrides.graphBase ?? `https://graph.facebook.com/${config.META_GRAPH_VERSION ?? "v21.0"}`,
  };
}

/**
 * X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, 原始请求体)。
 * 没配 secret、没带头、格式不对都算失败；比较用常数时间。必须拿原始字节算，JSON 重新序列化后对不上
 */
export function verifyMetaSignature(appSecret: string | undefined, rawBody: string, header: string | undefined): boolean {
  if (!appSecret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const provided = Buffer.from(m[1]!, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** WhatsApp 一条文字最长 4096 字；再长就拆成几条按顺序发 */
const WHATSAPP_TEXT_MAX = 4000;

export function chunkText(text: string, max = WHATSAPP_TEXT_MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    // 尽量在换行处断，没有就硬切
    const cut = rest.lastIndexOf("\n", max);
    let at = cut > max / 2 ? cut : max;
    // 不把 emoji 这类代理对切成两半：切点前一位是高位代理就往前退一格
    const before = rest.charCodeAt(at - 1);
    if (before >= 0xd800 && before <= 0xdbff) at -= 1;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  if (rest.length > 0 || out.length === 0) out.push(rest);
  return out;
}

export async function sendWhatsAppText(deps: MetaDeps, token: string, phoneNumberId: string, to: string, text: string): Promise<void> {
  for (const body of chunkText(text)) {
    const res = await deps.fetch(`${deps.graphBase}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body } }),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel().catch(() => {});
    // 不把响应体带进错误：Graph 的报错里会回显请求细节
    if (!res.ok) throw new Error(`whatsapp send failed: http ${res.status}`);
  }
}

/** 原图字节上限：和 LIMITS.imageBase64Bytes 对应（base64 膨胀 4/3） */
export const MEDIA_MAX_BYTES = Math.floor((LIMITS.imageBase64Bytes * 3) / 4);

export type MediaResult = { data: string; mimeType: string } | { error: "type" | "size" | "fetch" };

/**
 * WhatsApp 的图片分两步：先用媒体 id 问 Graph 要临时 URL 和元数据，再带 bearer 去取字节。
 * 元数据里的类型和大小先筛一遍，省得下载；URL 是 Meta 回的，仍然走 safeFetchBytes 的地址校验和字节上限
 */
export async function fetchWhatsAppMedia(deps: MetaDeps, token: string, mediaId: string): Promise<MediaResult> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) return { error: "fetch" };
  const auth = { authorization: `Bearer ${token}` };
  let meta: { url?: unknown; mime_type?: unknown; file_size?: unknown };
  try {
    const res = await deps.fetch(`${deps.graphBase}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { error: "fetch" };
    }
    meta = (await res.json()) as typeof meta;
  } catch {
    return { error: "fetch" };
  }
  const mimeType = typeof meta.mime_type === "string" ? meta.mime_type.split(";")[0]!.trim().toLowerCase() : "";
  if (!IMAGE_MIME_ALLOWLIST.has(mimeType)) return { error: "type" };
  if (typeof meta.file_size === "number" && meta.file_size > MEDIA_MAX_BYTES) return { error: "size" };
  if (typeof meta.url !== "string") return { error: "fetch" };
  try {
    const { bytes } = await safeFetchBytes(meta.url, { fetch: deps.fetch, lookup: deps.lookup, headers: auth, maxBytes: MEDIA_MAX_BYTES, accept: "image/*" });
    return { data: bytes.toString("base64"), mimeType };
  } catch (e) {
    return { error: /larger than/.test((e as Error).message) ? "size" : "fetch" };
  }
}
