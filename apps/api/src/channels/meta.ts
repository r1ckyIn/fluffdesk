import { createHmac, timingSafeEqual } from "node:crypto";
import { IMAGE_MIME_ALLOWLIST, LIMITS, ResponseTooLargeError, safeFetchBytes } from "@fluffdesk/core";

/**
 * Instagram 和 WhatsApp 共用的 Meta 这一层：webhook 验签、Graph API 发消息、拉媒体。
 * 两个产品挂在同一个 Meta 应用下，所以 App Secret 只有一个（META_APP_SECRET）。
 * 网络访问都从 deps 注入，测试里换成假的 fetch，不出网。
 */
export interface MetaDeps {
  fetch: typeof globalThis.fetch;
  /** 媒体 URL 的 DNS 解析，SSRF 护栏用；测试里固定成公网地址 */
  lookup?: (host: string) => Promise<string[]>;
  /** WhatsApp Cloud API 的 Graph 地址 */
  graphBase: string;
  /** Instagram Messaging API 的 Graph 地址：Instagram Login 路线是 graph.instagram.com，Unified Login 是 graph.facebook.com（INSTAGRAM_GRAPH_BASE 可改） */
  instagramGraphBase: string;
}

/** Graph 的版本段，两个产品的地址都靠它拼；"v21.0/"、整个 URL 这类笔误会拼出坏地址，启动时就拦 */
const GRAPH_VERSION = /^v\d+\.\d+$/;

export function metaDeps(config: Record<string, string | undefined>, overrides: Partial<MetaDeps> = {}): MetaDeps {
  const version = config.META_GRAPH_VERSION ?? "v21.0";
  if (!GRAPH_VERSION.test(version)) throw new Error(`META_GRAPH_VERSION must look like v21.0, got "${version}"`);
  return {
    fetch: overrides.fetch ?? globalThis.fetch,
    lookup: overrides.lookup,
    graphBase: overrides.graphBase ?? `https://graph.facebook.com/${version}`,
    instagramGraphBase: overrides.instagramGraphBase ?? instagramGraphBaseFrom(config.INSTAGRAM_GRAPH_BASE, version),
  };
}

/**
 * 配置里的 Instagram Graph 地址只能是 https 的 origin 加版本段（`https://host/v21.0`，尾斜杠可有可无）。
 * 裸主机、没版本、带 query/fragment/凭据、把整个端点填进来，这些笔误都在启动时报，不能到每次回复才 fetch 失败或把 bearer 发去别处
 */
function instagramGraphBaseFrom(raw: string | undefined, version: string): string {
  if (!raw) return `https://graph.instagram.com/${version}`;
  const hint = `INSTAGRAM_GRAPH_BASE must be https://<host>/${version} (origin + version only), got "${raw}"`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(hint);
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || !/^\/v\d+\.\d+\/?$/.test(u.pathname)) throw new Error(hint);
  return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
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
    // 不把 emoji 这类代理对切成两半：切点前一位是高位代理就往前退一格；退到 0 会原地打转，max=1 时宁可切坏也要前进
    const before = rest.charCodeAt(at - 1);
    if (before >= 0xd800 && before <= 0xdbff && at > 1) at -= 1;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, "");
  }
  if (rest.length > 0 || out.length === 0) out.push(rest);
  return out;
}

/**
 * 按 UTF-8 字节数拆块（Instagram 的上限是 1000 字节，中文一个字 3 字节）。按码点走不会切断代理对，
 * 尽量在换行处断。maxBytes 必须放得下任意一个码点（4 字节），否则抛错，不会死循环
 */
export function chunkByBytes(text: string, maxBytes: number): string[] {
  if (!(maxBytes >= 4)) throw new Error(`chunkByBytes: maxBytes must be >= 4, got ${maxBytes}`);
  const size = (s: string) => Buffer.byteLength(s, "utf8");
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let lastNl = -1; // cur 里最后一个换行的下标
  for (const ch of text) {
    const b = size(ch);
    if (curBytes + b > maxBytes) {
      // 换行在后半段就在换行处断，否则硬切
      const at = lastNl >= 0 && size(cur.slice(0, lastNl)) > maxBytes / 2 ? lastNl : cur.length;
      out.push(cur.slice(0, at));
      cur = cur.slice(at).replace(/^\n/, "");
      curBytes = size(cur);
      lastNl = cur.lastIndexOf("\n");
    }
    cur += ch;
    curBytes += b;
    if (ch === "\n") lastNl = cur.length - 1;
  }
  if (cur.length > 0 || out.length === 0) out.push(cur);
  return out;
}

/** Instagram 一条文字最多 1000 字节，留点余量 */
const INSTAGRAM_TEXT_MAX_BYTES = 950;

/**
 * POST /me/messages：Instagram Login 路线（graph.instagram.com，Bearer 是 Instagram 用户 token）和 Unified Login 路线
 * （graph.facebook.com，System User token）都认 /me，不用猜该填 IG 账号 id 还是 page id
 */
export async function sendInstagramText(deps: MetaDeps, token: string, to: string, text: string): Promise<void> {
  for (const body of chunkByBytes(text, INSTAGRAM_TEXT_MAX_BYTES)) {
    const res = await deps.fetch(`${deps.instagramGraphBase}/me/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: to }, message: { text: body } }),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel().catch(() => {});
    if (!res.ok) throw new Error(`instagram send failed: http ${res.status}`);
  }
}

/**
 * Instagram 的附件是 CDN 直链（lookaside），不带令牌直接取。URL 来自 Meta 的 payload，照样过 safeFetchBytes 的地址校验和字节上限；
 * 类型只能看响应的 content-type
 */
export async function fetchInstagramImage(deps: MetaDeps, url: string): Promise<MediaResult> {
  try {
    const { bytes, contentType } = await safeFetchBytes(url, { fetch: deps.fetch, lookup: deps.lookup, maxBytes: MEDIA_MAX_BYTES, accept: "image/*" });
    const mimeType = contentType.split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_MIME_ALLOWLIST.has(mimeType)) return { error: "type" };
    return { data: bytes.toString("base64"), mimeType };
  } catch (e) {
    return { error: e instanceof ResponseTooLargeError ? "size" : "fetch" };
  }
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
    return { error: e instanceof ResponseTooLargeError ? "size" : "fetch" };
  }
}
