import postgres from "postgres";

/** 连通性检查：npm run db:check -w packages/db。只打印版本和主机，不打印连接串 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const host = new URL(url).host;
const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 15 });
try {
  const [row] = await sql`select version() as version, current_database() as db, now() as now`;
  console.log(`ok  host=${host}\n    db=${row?.db}\n    ${String(row?.version).split(",")[0]}\n    server time ${row?.now}`);
} catch (e) {
  console.error(`failed host=${host}: ${(e as Error).message}`);
  process.exit(1);
} finally {
  await sql.end();
}
