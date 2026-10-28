import type { ShopChannels, ShopConfig } from "./schema.js";

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

/**
 * 按渠道账号 id 找店：WhatsApp 用 phone_number_id，Instagram 用专业账号 id。
 * 店很少（几十家），list 后过滤就够了，不用给每个存储实现加查询。id 必须完全相等，空字符串永远对不上
 */
export async function findShopByChannel(repo: ShopRepo, channel: keyof ShopChannels, accountId: string): Promise<ShopConfig | undefined> {
  if (!accountId) return undefined;
  const shops = await repo.list();
  return shops.find((s) => {
    const binding = s.channels?.[channel];
    if (!binding) return false;
    const id = channel === "whatsapp" ? (binding as { phoneNumberId: string }).phoneNumberId : (binding as { accountId: string }).accountId;
    return id === accountId;
  });
}
