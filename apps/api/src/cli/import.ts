import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createGateway, importGoogleBusiness, importScreenshots, importWebsite, mergeDrafts, LOW_CONFIDENCE, type ShopDraft } from "@fluffdesk/core";

/**
 * 从公开信息生成店铺草稿。
 *
 *   npm run import -- --slug fluffy-paws --website https://example.com \
 *       --google "Fluffy Paws Newtown" --screenshots ./ig-shots --name "Fluffy Paws"
 *
 * 输出 packages/eval/datasets/shops/<slug>.draft.json，低置信度字段和缺失字段打印出来。
 * 草稿不是正式配置：美容师在后台确认后才会进 shops 表。
 */
const args = parseArgs(process.argv.slice(2));
const slug = args.slug;
if (!slug || (!args.website && !args.google && !args.screenshots)) {
  console.error("usage: npm run import -- --slug <slug> [--name <name>] [--website <url>] [--google <query>] [--screenshots <dir>] [--out <dir>]");
  process.exit(2);
}

const gateway = createGateway();
const drafts: ShopDraft[] = [];

if (args.google) {
  console.log(`google: "${args.google}"`);
  drafts.push(await importGoogleBusiness(args.google));
}
if (args.website) {
  console.log(`website: ${args.website}`);
  drafts.push(await importWebsite(gateway, args.website));
}
if (args.screenshots) {
  const dir = resolve(args.screenshots);
  const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  console.log(`screenshots: ${files.length} file(s) in ${dir}`);
  const images = files.map((f) => ({ data: readFileSync(join(dir, f)).toString("base64"), mimeType: mime(f) }));
  if (images.length) drafts.push(await importScreenshots(gateway, images, { origin: "instagram", name: args.name }));
}

const merged = mergeDrafts(drafts, { slug, currency: "AUD", timezone: "Australia/Sydney", ...(args.name ? { name: args.name } : {}) });
const outDir = resolve(args.out ?? "packages/eval/datasets/shops");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${slug}.draft.json`);
writeFileSync(outFile, JSON.stringify({ ...merged, generatedAt: new Date().toISOString() }, null, 2));

console.log(`\nwrote ${outFile}`);
console.log(`fields: ${Object.keys(merged.partial).join(", ")}`);
const low = Object.entries(merged.confidence).filter(([, c]) => (c ?? 0) < LOW_CONFIDENCE);
if (low.length) console.log(`check these (low confidence): ${low.map(([k, c]) => `${k}=${(c ?? 0).toFixed(2)}`).join(", ")}`);
if (merged.missing.length) console.log(`missing (fill by hand): ${merged.missing.join(", ")}`);
for (const n of merged.notes) console.log(`  - ${n}`);

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = "true";
    }
  }
  return out;
}
function mime(f: string): string {
  const e = extname(f).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : "image/jpeg";
}
