import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * 给导入器用的抓取：只许 http(s)，解析出来的地址不能是内网、回环、链路本地，
 * 重定向手动跟、每一跳重新校验，正文读取有字节上限。
 * 这是 SSRF 的护栏：官网 URL 是用户给的，不能让它把服务器指到 169.254.169.254 或 10.x。
 * 已知局限：先解析再 fetch 有 DNS rebinding 的窗口；上线后在出口网络层再拦一道。
 */
export interface SafeFetchOptions {
  fetch?: typeof globalThis.fetch;
  lookup?: (host: string) => Promise<string[]>;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export interface SafeFetchResult {
  html: string;
  url: string;
}

export class UnsafeUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`refusing to fetch ${url}: ${reason}`);
  }
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    // IPv4 映射地址 ::ffff:a.b.c.d
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]!);
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 唯一本地
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 链路本地
    return false;
  }
  return true; // 不是合法 IP 一律当不安全
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

async function assertSafeUrl(raw: string, lookup: NonNullable<SafeFetchOptions["lookup"]>): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError(raw, "invalid url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError(raw, `scheme ${u.protocol} not allowed`);
  if (u.username || u.password) throw new UnsafeUrlError(raw, "credentials in url");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new UnsafeUrlError(raw, "local hostname");
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => []);
  if (addresses.length === 0) throw new UnsafeUrlError(raw, "hostname does not resolve");
  for (const ip of addresses) if (isPrivateAddress(ip)) throw new UnsafeUrlError(raw, `resolves to private address ${ip}`);
  return u;
}

const defaultLookup = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address);

export async function safeFetchHtml(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const lookup = opts.lookup ?? defaultLookup;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertSafeUrl(current, lookup);
    const res = await fetchImpl(u.toString(), {
      headers: { "user-agent": opts.userAgent ?? "fluffdesk-importer/0.1 (+https://github.com/r1ckyIn/fluffdesk)", accept: "text/html" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new UnsafeUrlError(current, `redirect without location`);
      current = new URL(loc, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`http ${res.status} for ${current}`);
    if (!(res.headers.get("content-type") ?? "").includes("html")) throw new Error(`not html: ${current}`);
    return { html: await readCapped(res, maxBytes), url: u.toString() };
  }
  throw new UnsafeUrlError(raw, `more than ${maxRedirects} redirects`);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
