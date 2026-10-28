import { and, asc, eq } from "drizzle-orm";
import { parseShopConfig, type ShopConfig, type ShopRepo } from "@fluffdesk/core";
import type { Db } from "../client.js";
import { shops } from "../schema.js";

/** 只回 approved 的店：草稿在美容师确认前 agent 看不到 */
export class PgShopRepo implements ShopRepo {
  constructor(private readonly db: Db) {}

  async get(slug: string): Promise<ShopConfig | undefined> {
    const [row] = await this.db
      .select({ config: shops.config })
      .from(shops)
      .where(and(eq(shops.slug, slug), eq(shops.approved, true)))
      .limit(1);
    return row ? parseShopConfig(row.config) : undefined;
  }

  async list(): Promise<ShopConfig[]> {
    const rows = await this.db.select({ config: shops.config }).from(shops).where(eq(shops.approved, true)).orderBy(asc(shops.slug));
    return rows.map((r) => parseShopConfig(r.config));
  }

  /** seed 和导入器用：写入或整份覆盖。approved 由调用方决定，默认当草稿 */
  async upsert(config: unknown, opts: { approved: boolean } = { approved: false }): Promise<ShopConfig> {
    const cfg = parseShopConfig(config);
    await this.db
      .insert(shops)
      .values({ slug: cfg.slug, config: cfg, approved: opts.approved })
      .onConflictDoUpdate({ target: shops.slug, set: { config: cfg, approved: opts.approved, updatedAt: new Date() } });
    return cfg;
  }
}
