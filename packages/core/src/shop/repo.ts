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
  /** 渠道账号 id 已被别的店（含草稿）绑着时抛 ChannelBindingConflictError，不写入 */
  save(config: ShopConfig): Promise<boolean>;
}

/** 一个渠道账号只能绑一家店。存储层保证（Postgres 用唯一索引，内存版查一遍），路由层只负责翻成 409 */
export class ChannelBindingConflictError extends Error {
  constructor(public readonly channel: keyof ShopChannels) {
    super(`${channel} account already bound to another shop`);
  }
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
    const conflicts = channelBindingConflicts([...this.items.values()], config);
    if (conflicts.length > 0) throw new ChannelBindingConflictError(conflicts[0]!.channel);
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
  return shops.find((s) => channelAccountId(s, channel) === accountId);
}

const CHANNELS = ["whatsapp", "instagram"] as const satisfies ReadonlyArray<keyof ShopChannels>;

function channelAccountId(shop: ShopConfig, channel: keyof ShopChannels): string | undefined {
  const binding = shop.channels?.[channel];
  if (!binding) return undefined;
  return channel === "whatsapp" ? (binding as { phoneNumberId: string }).phoneNumberId : (binding as { accountId: string }).accountId;
}

/**
 * 写边界用：一个渠道账号只能绑一家店，否则消息会路由到先匹配到的那家。
 * 返回和别的店冲突的渠道和那家店，空数组表示可以写。自己已有的绑定不算冲突
 */
export function channelBindingConflicts(existing: ShopConfig[], config: ShopConfig): Array<{ channel: keyof ShopChannels; slug: string }> {
  const out: Array<{ channel: keyof ShopChannels; slug: string }> = [];
  for (const channel of CHANNELS) {
    const id = channelAccountId(config, channel);
    if (!id) continue;
    for (const other of existing) {
      if (other.slug !== config.slug && channelAccountId(other, channel) === id) out.push({ channel, slug: other.slug });
    }
  }
  return out;
}
