/** 没有依赖的 HTML 转文本，够抓小店官网用 */
export function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|td|th)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(x[0-9a-f]+|\d+);/gi, (m, n: string) => {
    const code = n[0]?.toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
    // 超出 Unicode 范围的实体 fromCodePoint 会抛 RangeError，原样保留
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
  return s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      if (!/^https?:$/.test(u.protocol)) continue;
      // 锚点去掉就是同一页，/services#pricing 这种在小店官网很常见
      if (u.origin === new URL(base).origin) out.add(u.origin + u.pathname.replace(/\/$/, ""));
    } catch {
      /* 非法链接跳过 */
    }
  }
  return [...out];
}
