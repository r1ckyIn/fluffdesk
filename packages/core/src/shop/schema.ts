import { Type, type Static } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";

/** 中英双语文案 */
export const I18nText = Type.Object({ en: Type.String(), zh: Type.String() });
export type I18nText = Static<typeof I18nText>;

/** 体型档位 id，店铺自己定义档位，这里只约束是字符串 */
export const SizeTierId = Type.String({ description: "store-defined size tier id, e.g. small/medium/large" });

export const SizeTier = Type.Object({
  id: SizeTierId,
  label: I18nText,
  maxKg: Type.Optional(Type.Number({ description: "upper bound of this tier in kg; last tier may omit" })),
});
export type SizeTier = Static<typeof SizeTier>;

export const CoatType = Type.Union([
  Type.Literal("short"),
  Type.Literal("double"),
  Type.Literal("curly"),
  Type.Literal("wire"),
  Type.Literal("long"),
]);
export type CoatType = Static<typeof CoatType>;

/** 一条价目：某服务在某体型（可选毛质）下的区间。报价工具只会在这些区间里取值 */
export const PriceRule = Type.Object({
  size: SizeTierId,
  coat: Type.Optional(CoatType),
  min: Type.Number({ minimum: 0 }),
  max: Type.Number({ minimum: 0 }),
});
export type PriceRule = Static<typeof PriceRule>;

export const Service = Type.Object({
  id: Type.String(),
  name: I18nText,
  description: Type.Optional(I18nText),
  durationMin: Type.Integer({ minimum: 15 }),
  prices: Type.Array(PriceRule, { minItems: 1 }),
});
export type Service = Static<typeof Service>;

export const DayHours = Type.Union([
  Type.Null(),
  Type.Object({ open: Type.String({ pattern: "^\\d{2}:\\d{2}$" }), close: Type.String({ pattern: "^\\d{2}:\\d{2}$" }) }),
]);

/** 周一起的顺序，所有地方都从这里拿，不要再手抄 */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const Weekday = Type.Union([
  Type.Literal("mon"), Type.Literal("tue"), Type.Literal("wed"), Type.Literal("thu"),
  Type.Literal("fri"), Type.Literal("sat"), Type.Literal("sun"),
]);
export type Weekday = (typeof WEEKDAYS)[number];

/** 资料来源，导入器填，便于追溯和刷新 */
export const ShopSource = Type.Object({
  type: Type.Union([Type.Literal("instagram"), Type.Literal("google"), Type.Literal("website"), Type.Literal("manual")]),
  url: Type.Optional(Type.String()),
  fetchedAt: Type.String({ description: "ISO datetime" }),
});
export type ShopSource = Static<typeof ShopSource>;

export const ShopConfig = Type.Object({
  slug: Type.String({ pattern: "^[a-z0-9-]+$" }),
  name: Type.String(),
  timezone: Type.String({ default: "Australia/Sydney" }),
  currency: Type.Literal("AUD"),
  address: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  website: Type.Optional(Type.String()),
  hours: Type.Record(Weekday, DayHours),
  sizeTiers: Type.Array(SizeTier, { minItems: 1 }),
  services: Type.Array(Service, { minItems: 1 }),
  policies: Type.Object({
    /** 报价免责声明，每次报价都带 */
    quoteDisclaimer: I18nText,
    /** 自由文本：预约规则、取消政策、不接的品种等，进系统提示 */
    notes: Type.Optional(I18nText),
  }),
  sources: Type.Optional(Type.Array(ShopSource)),
});
export type ShopConfig = Static<typeof ShopConfig>;

export function parseShopConfig(input: unknown): ShopConfig {
  const withDefaults = Value.Default(ShopConfig, input);
  if (!Value.Check(ShopConfig, withDefaults)) {
    const errors = [...Value.Errors(ShopConfig, withDefaults)].slice(0, 5).map((e) => `${e.instancePath || "/"}: ${e.message}`);
    throw new Error(`invalid shop config: ${errors.join("; ")}`);
  }
  return withDefaults;
}

/**
 * 写边界用：schema 之外再查引用完整性。读路径（PgShopRepo.get/list）只用 parseShopConfig，
 * 不然库里一条老配置有问题就整店读不出来，连去修它的 PUT 都进不去。
 */
export function validateShopConfig(input: unknown): ShopConfig {
  const shop = parseShopConfig(input);
  const problems = shopReferenceProblems(shop);
  if (problems.length > 0) throw new Error(`invalid shop config: ${problems.slice(0, 5).join("; ")}`);
  return shop;
}

/**
 * schema 管不到的引用完整性：id 是 agent、价目表和历史预约之间的钥匙，重复的 id 会让 findService 悄悄取到错的那条，
 * 价目指向不存在的体型档会让 quote 找不到价。美容师端 PUT、seed 的 upsert 都在写入前查（导入器只写 JSON 文件，不进库）。
 */
export function shopReferenceProblems(shop: ShopConfig): string[] {
  const out: string[] = [];
  const tierIds = shop.sizeTiers.map((t) => t.id);
  const serviceIds = shop.services.map((s) => s.id);
  for (const id of duplicates(tierIds)) out.push(`/sizeTiers: duplicate id "${id}"`);
  for (const id of duplicates(serviceIds)) out.push(`/services: duplicate id "${id}"`);
  const tiers = new Set(tierIds);
  shop.services.forEach((svc, i) => {
    svc.prices.forEach((p, k) => {
      if (!tiers.has(p.size)) out.push(`/services/${i}/prices/${k}/size: unknown size tier "${p.size}"`);
    });
  });
  return out;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export function findService(shop: ShopConfig, serviceId: string): Service | undefined {
  return shop.services.find((s) => s.id === serviceId);
}

export function sizeTierForKg(shop: ShopConfig, kg: number): SizeTier {
  for (const tier of shop.sizeTiers) {
    if (tier.maxKg === undefined || kg <= tier.maxKg) return tier;
  }
  return shop.sizeTiers[shop.sizeTiers.length - 1]!;
}
