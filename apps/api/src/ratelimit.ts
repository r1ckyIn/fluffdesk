/**
 * 内存版固定窗口限流。单实例够用；多实例时换成数据库或 Redis 计数，接口不变。
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** 返回 true 表示放行 */
  take(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 50_000) this.sweep(now);
      return true;
    }
    if (cur.count >= this.limit) return false;
    cur.count++;
    return true;
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

/** 带 TTL 和容量上限的 Map：会话存储用。超容量先删最久没动的 */
export class BoundedStore<V> {
  private readonly items = new Map<string, { value: V; touchedAt: number }>();

  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {}

  get(key: string, now = Date.now()): V | undefined {
    const it = this.items.get(key);
    if (!it) return undefined;
    if (it.touchedAt + this.ttlMs <= now) {
      this.items.delete(key);
      return undefined;
    }
    it.touchedAt = now;
    this.items.delete(key);
    this.items.set(key, it); // Map 保持插入顺序，重插等于移到最新
    return it.value;
  }

  set(key: string, value: V, now = Date.now()): void {
    this.items.delete(key);
    this.items.set(key, { value, touchedAt: now });
    // 超容量从最旧的开始删，直到回到上限
    for (const k of this.items.keys()) {
      if (this.items.size <= this.maxEntries) break;
      this.items.delete(k);
    }
  }

  get size(): number {
    return this.items.size;
  }
}
