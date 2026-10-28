import type { ShopConfig } from "./schema.js";

/**
 * 店铺配置的只读口。agent 和路由只读；写入在 seed、导入器和美容师端。
 * 实现可以是 Postgres，也可以是测试和 demo 用的内存版。
 */
export interface ShopRepo {
  get(slug: string): Promise<ShopConfig | undefined>;
  list(): Promise<ShopConfig[]>;
}

/**
 * 店铺配置的写口，只给美容师端用。agent 和渠道层拿不到它。
 * 只改已经存在（且已确认）的店；不存在或还是草稿就回 false，不会把草稿顺手变成正式店。
 */
export interface ShopEditor {
  save(config: ShopConfig): Promise<boolean>;
}

export class InMemoryShopRepo implements ShopRepo, ShopEditor {
  private readonly items: Map<string, ShopConfig>;
  constructor(shops: ShopConfig[]) {
    this.items = new Map(shops.map((s) => [s.slug, s]));
  }
  async get(slug: string) {
    return this.items.get(slug);
  }
  async list() {
    return [...this.items.values()];
  }
  async save(config: ShopConfig) {
    if (!this.items.has(config.slug)) return false;
    this.items.set(config.slug, config);
    return true;
  }
}
