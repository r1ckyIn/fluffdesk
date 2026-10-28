import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

/**
 * 把 migrations/ 里还没跑过的 SQL 按顺序跑到 DATABASE_URL 指向的库。
 * 本地：npm run db:migrate -w packages/db。线上：fly.toml 的 release_command 在每次部署前跑它。
 * 迁移文件由 drizzle-kit generate 从 schema.ts 生成，手改 schema 后要重新生成并提交。
 * 任何失败都只打一行，不打连接串。
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
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
