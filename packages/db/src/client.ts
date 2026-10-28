import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * 存储实现只依赖这个抽象类型：生产是 postgres-js 连 Neon，测试是 PGlite（WASM 里的真 Postgres），
 * 两边跑的是同一份 SQL 和同一份迁移。
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Neon 悉尼区。连接串从 DATABASE_URL 来，代码里不出现任何凭据 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  // Neon 的 -pooler 地址是 PgBouncer 事务模式，关掉 postgres-js 的命名预处理语句才稳
  const sql = postgres(url, { ssl: "require", max: 5, prepare: false });
  return drizzle(sql, { schema });
}
