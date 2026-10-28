import { beforeAll, describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/schema.js";
import { APP_ROLE, appRoleGrants } from "../src/app-role.js";

/**
 * API 进程的角色只能做 DML。这里在 PGlite 里按 create-app-role.ts 同一份授权语句建角色，
 * 切过去验证：能读写表，不能建表、不能动别的 schema、迁移以后新建的表也自动可写。
 */
let pg: PGlite;
const asApp = async <T>(fn: () => Promise<T>): Promise<T> => {
  await pg.exec(`set role ${APP_ROLE}`);
  try {
    return await fn();
  } finally {
    await pg.exec("reset role");
  }
};

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../migrations") });
  await pg.exec(`create role ${APP_ROLE} login`);
  for (const stmt of appRoleGrants("postgres")) await pg.exec(stmt);
}, 60_000);

describe("fluffdesk_app role", () => {
  it("can read and write application tables", async () => {
    await asApp(async () => {
      await pg.query(`insert into shops (slug, config, approved) values ($1, $2, true)`, ["s1", JSON.stringify({ slug: "s1" })]);
      await pg.query(`update shops set approved = false where slug = $1`, ["s1"]);
      expect((await pg.query(`select slug from shops`)).rows).toHaveLength(1);
      await pg.query(`delete from shops where slug = $1`, ["s1"]);
    });
  });
  it("cannot create or drop tables, nor touch the migrations schema", async () => {
    await asApp(async () => {
      await expect(pg.exec("create table probe (id int)")).rejects.toThrow(/permission denied/);
      await expect(pg.exec("drop table bookings")).rejects.toThrow(/must be owner/);
      await expect(pg.exec("alter table bookings add column x int")).rejects.toThrow(/must be owner/);
      await expect(pg.query("select * from drizzle.__drizzle_migrations")).rejects.toThrow(/permission denied/);
      await expect(pg.exec("create schema evil")).rejects.toThrow(/permission denied/);
    });
  });
  it("gets access to tables created by later migrations without re-granting", async () => {
    await pg.exec("create table added_by_next_migration (id text primary key, n int)");
    await asApp(async () => {
      await pg.query("insert into added_by_next_migration values ($1, 1)", ["a"]);
      await pg.query("update added_by_next_migration set n = 2 where id = $1", ["a"]);
      expect((await pg.query("select n from added_by_next_migration")).rows).toEqual([{ n: 2 }]);
      await pg.query("delete from added_by_next_migration where id = $1", ["a"]);
    });
  });
});
