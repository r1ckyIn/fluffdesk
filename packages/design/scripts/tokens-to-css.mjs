// 把 project/tokens.json 生成为 dist/tokens.css 和 apps/web/app/tokens.css。tokens.json 是唯一正本；不要手改 tokens.css。
// web 那份提交进仓库：Vercel 以 apps/web 为根单独构建，拿不到 workspace 里的 dist。
// 用法：node scripts/tokens-to-css.mjs [--check]   --check 只比对，不一致退出码 1（CI 用）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "project/tokens.json"), "utf8"));
const outputs = [join(root, "dist/tokens.css"), join(root, "../../apps/web/app/tokens.css")];

const lines = [`/* ${tokens.name} — generated from project/tokens.json; do not edit */`, ":root {"];
const theme = tokens.color.themes[0].id;
for (const t of tokens.color.tokens) {
  const raw = typeof t.value === "string" ? t.value : t.value[theme];
  const alias = raw.match(/^\{(.+)\}$/);
  lines.push(`  --color-${t.name}: ${alias ? `var(--color-${alias[1]})` : raw};`);
}
for (const [k, v] of Object.entries(tokens.type.families)) lines.push(`  --font-${k}: ${v};`);
for (const g of tokens.type.groups) {
  for (const s of g.styles) lines.push(`  --type-${s.name}: ${s.fontWeight} ${s.fontSize}/${s.lineHeight} var(--font-${g.family});`);
}
for (const fam of ["spacing", "size", "radius"]) {
  for (const t of tokens[fam]?.tokens ?? []) lines.push(`  --${fam === "size" ? "size-" : ""}${t.name}: ${t.value};`); // spacing 和 radius 的名字自带前缀
}
lines.push("}", "");
const css = lines.join("\n");

if (process.argv.includes("--check")) {
  for (const out of outputs) {
    const current = existsSync(out) ? readFileSync(out, "utf8") : "";
    if (current !== css) {
      console.error(`${out} 和 project/tokens.json 不一致，跑 npm run build -w packages/design`);
      process.exit(1);
    }
  }
  console.log("tokens.css up to date");
} else {
  for (const out of outputs) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, css);
    console.log(`wrote ${out} (${lines.length - 3} tokens)`);
  }
}
