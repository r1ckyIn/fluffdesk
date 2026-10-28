import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

/**
 * 把 migrations/ 里还没跑过的 SQL 按顺序跑到目标库。
 * 迁移要 DDL 权限，所以优先用 MIGRATE_DATABASE_URL（owner 角色）；没配就用 DATABASE_URL（本地 dev 分支就是 owner 串）。
 * 线上 DATABASE_URL 是只有 DML 的 fluffdesk_app，必须另配 MIGRATE_DATABASE_URL。
 * 本地：npm run db:migrate -w packages/db。线上：fly.toml 的 release_command 在每次部署前跑它。
 * 迁移文件由 drizzle-kit generate 从 schema.ts 生成，手改 schema 后要重新生成并提交。
 * 任何失败都只打一行，不打连接串。
 */
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("MIGRATE_DATABASE_URL or DATABASE_URL must be set");
  process.exit(2);
}
let db: ReturnType<typeof createDb> | undefined;
try {
  const host = new URL(url).host;
  db = createDb(url);
  await migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../migrations") });
  console.log(`migrations applied host=${host}`);
} catch (e) {
  console.error(`migration failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db?.$client.end();
}
