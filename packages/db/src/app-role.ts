/**
 * API 进程用的最小权限角色：能连库、能读写 public 里的表，不能建表、不能碰别的 schema。
 * 这里只有授权语句，不含密码；create-app-role.ts 建角色后跑它，测试在 PGlite 里跑它验证降权有效。
 * 迁移由 owner 角色跑，所以 ALTER DEFAULT PRIVILEGES 要以 owner 身份执行，以后新建的表才会自动授权。
 */
export const APP_ROLE = "fluffdesk_app";

/** 标识符加引号，内部的引号翻倍 */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function appRoleGrants(dbName: string, role = APP_ROLE): string[] {
  const r = ident(role);
  return [
    // PG 15 起 public 默认不给 PUBLIC CREATE，老版本的库要显式收掉，不然 app 角色照样能建表
    `revoke create on schema public from public`,
    `grant connect on database ${ident(dbName)} to ${r}`,
    `grant usage on schema public to ${r}`,
    `grant select, insert, update, delete on all tables in schema public to ${r}`,
    `grant usage on all sequences in schema public to ${r}`,
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${r}`,
    `alter default privileges in schema public grant usage on sequences to ${r}`,
  ];
}
