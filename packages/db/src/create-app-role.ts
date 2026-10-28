import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { APP_ROLE, appRoleGrants } from "./app-role.js";

/**
 * 一次性：用 owner 串在当前分支建最小权限角色 fluffdesk_app（只有 DML，没有 CREATE），
 * 把 app 连接串写到 ~/.config/fluffdesk/<branch-label>-app.url（0600）。全程不打印任何凭据。
 * 角色已存在就只轮换密码并重新授权。
 */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const label = process.argv[2] ?? "production";
const ROLE = APP_ROLE;
const password = randomBytes(24).toString("base64url");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const owner = postgres(url, { ssl: "require", max: 1, prepare: false });
try {
  const [dbRow] = await owner`select current_database() as db`;
  const dbName = String(dbRow?.db);
  const [exists] = await owner`select 1 from pg_roles where rolname = ${ROLE}`;
  if (exists) await owner.unsafe(`alter role ${ROLE} with login password ${lit(password)}`);
  else await owner.unsafe(`create role ${ROLE} with login password ${lit(password)}`);
  for (const stmt of appRoleGrants(dbName, ROLE)) await owner.unsafe(stmt);
  console.log(`role ${ROLE} ${exists ? "rotated" : "created"} on db=${dbName}`);
} finally {
  await owner.end();
}

const appUrl = new URL(url);
appUrl.username = ROLE;
appUrl.password = password;
const dir = join(homedir(), ".config", "fluffdesk");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const out = join(dir, `${label}-app.url`);
writeFileSync(out, appUrl.toString() + "\n", { mode: 0o600 });
chmodSync(out, 0o600);

// 验证：app 角色能读 shops，不能建表
const app = postgres(appUrl.toString(), { ssl: "require", max: 1, prepare: false });
try {
  const [row] = await app`select count(*)::int as n from shops`;
  console.log(`verify: app role can read shops (${row?.n} rows)`);
  let ddlBlocked = false;
  try {
    await app.unsafe("create table _role_probe (id int)");
    await app.unsafe("drop table _role_probe");
  } catch {
    ddlBlocked = true;
  }
  console.log(`verify: DDL ${ddlBlocked ? "blocked" : "NOT blocked (check grants)"}`);
} finally {
  await app.end();
}
console.log(`app connection string written to ${out} (mode 0600)`);
