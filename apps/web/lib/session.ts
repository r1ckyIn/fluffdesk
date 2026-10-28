/**
 * 过渡期的登录：美容师粘一次共享 token，连同店铺 slug 和自己的名字存在本机浏览器里。
 * 正式方案是 magic link（better-auth）+ cookie，到时候这个文件整个换掉，调用方不变。
 */
export interface GroomerSession {
  shop: string;
  name: string;
  token: string;
}

const KEY = "fluffdesk.groomer";

export function readSession(): GroomerSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<GroomerSession>;
    if (typeof s.shop !== "string" || typeof s.name !== "string" || typeof s.token !== "string") return null;
    return { shop: s.shop, name: s.name, token: s.token };
  } catch {
    return null;
  }
}

export function writeSession(s: GroomerSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式下存不进去：这一页能用，刷新要重登 */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
