import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client.js";
import { PgShopRepo } from "./stores/shops.js";

/**
 * 把一份店铺 JSON（默认 packages/eval/datasets/shops.json，demo 店）整份 upsert 进 shops 表并标为 approved。
 *   npm run db:seed -w packages/db                       demo 店
 *   npm run db:seed -w packages/db -- path/to/shop.json  一家店或多家店的 JSON
 * 文件格式：单个店铺配置，或 { slug: 配置 } 的对象。配置先过 core 的 schema 校验，不合法整份不写。
 * 真店的导入草稿不要用这个灌：草稿要走美容师确认流（README TODO）。
 */
const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.INIT_CWD ?? process.cwd();
const file = process.argv[2] ? resolve(base, process.argv[2]) : resolve(here, "../../eval/datasets/shops.json");
const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
const entries = typeof raw.slug === "string" ? [raw] : Object.values(raw);

const db = createDb();
const repo = new PgShopRepo(db);
try {
  for (const entry of entries) {
    const cfg = await repo.upsert(entry, { approved: true });
    console.log(`upserted ${cfg.slug} (${cfg.services.length} services)`);
  }
} finally {
  await db.$client.end();
}
