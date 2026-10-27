import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

/** Neon 悉尼区。连接串从 DATABASE_URL 来，代码里不出现任何凭据 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { ssl: "require", max: 5 });
  return drizzle(sql, { schema });
}
