import { and, asc, eq, or, sql } from "drizzle-orm";
import { parseShopConfig, type ShopConfig, type ShopEditor, type ShopRepo } from "@fluffdesk/core";
import type { Db } from "../client.js";
import { shops } from "../schema.js";

/** 只回 approved 的店：草稿在美容师确认前 agent 看不到 */
export class PgShopRepo implements ShopRepo, ShopEditor {
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

  /** 美容师端改资料：只改已确认的店，草稿和不存在的店回 false。整份覆盖，先过 core 的 schema */
  async save(config: ShopConfig): Promise<boolean> {
    const cfg = parseShopConfig(config);
    const rows = await this.db
      .update(shops)
      .set({ config: cfg, updatedAt: new Date() })
      .where(and(eq(shops.slug, cfg.slug), eq(shops.approved, true)))
      .returning({ slug: shops.slug });
    return rows.length > 0;
  }

  /**
   * seed 和导入器用：写入或整份覆盖。approved 由调用方决定。
   * 草稿（approved=false）永远盖不掉已确认的店：导入器重跑不能让正在营业的店从 agent 面前消失。
   * 返回 written=false 表示因此被跳过。
   */
  async upsert(config: unknown, opts: { approved: boolean }): Promise<{ config: ShopConfig; written: boolean }> {
    const cfg = parseShopConfig(config);
    const rows = await this.db
      .insert(shops)
      .values({ slug: cfg.slug, config: cfg, approved: opts.approved })
      .onConflictDoUpdate({
        target: shops.slug,
        set: { config: cfg, approved: opts.approved, updatedAt: new Date() },
        setWhere: or(eq(shops.approved, false), sql`excluded.approved`),
      })
      .returning({ slug: shops.slug });
    return { config: cfg, written: rows.length > 0 };
  }
}
