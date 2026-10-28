import type { ShopConfig } from "./schema.js";

/**
 * 店铺配置的只读口。agent 和路由只读；写入在 seed、导入器和美容师端。
 * 实现可以是 Postgres，也可以是测试和 demo 用的内存版。
 */
export interface ShopRepo {
  get(slug: string): Promise<ShopConfig | undefined>;
  list(): Promise<ShopConfig[]>;
}

export class InMemoryShopRepo implements ShopRepo {
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
}
