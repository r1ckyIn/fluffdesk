import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "./registry.js";
import { findService, type ShopConfig, type CoatType } from "../shop/schema.js";

export interface QuoteResult {
  serviceId: string;
  size: string;
  coat?: string;
  min: number;
  max: number;
  currency: "AUD";
  durationMin: number;
}

/**
 * 纯函数：按价目表算区间。模型拿不到价目表原文，只能通过这里拿数字，
 * 所以"不能超出价目表"由代码保证，不靠提示词。
 */
export function computeQuote(shop: ShopConfig, serviceId: string, size: string, coat?: CoatType): QuoteResult {
  const service = findService(shop, serviceId);
  if (!service) throw new Error(`unknown service: ${serviceId}`);
  if (!shop.sizeTiers.some((t) => t.id === size)) throw new Error(`unknown size tier: ${size}`);
  const exact = coat ? service.prices.find((p) => p.size === size && p.coat === coat) : undefined;
  const generic = service.prices.find((p) => p.size === size && p.coat === undefined);
  const rule = exact ?? generic;
  if (!rule) throw new Error(`no price for ${serviceId} at size ${size}`);
  return { serviceId, size, coat, min: rule.min, max: rule.max, currency: "AUD", durationMin: service.durationMin };
}

export const quoteTool = defineTool({
  permission: "read",
  definition: {
    name: "quote",
    description:
      "Get the price range for a service from the shop's price list. Always call this before mentioning any price. " +
      "Quote only the returned range and always add the disclaimer that the final price is assessed in store.",
    parameters: Type.Object({
      serviceId: Type.String({ description: "service id from the shop's service list" }),
      size: Type.String({ description: "size tier id from the shop's size tiers" }),
      coat: Type.Optional(Type.String({ description: "coat type if known: short|double|curly|wire|long" })),
    }),
  },
  async run(args, ctx) {
    try {
      const q = computeQuote(ctx.shop, args.serviceId, args.size, args.coat as CoatType | undefined);
      const disclaimer = ctx.shop.policies.quoteDisclaimer[ctx.locale];
      return {
        text: `${q.currency} ${q.min}-${q.max}, about ${q.durationMin} min. Disclaimer to include: "${disclaimer}"`,
        details: { ...q, coat: q.coat ?? null },
      };
    } catch (e) {
      return { text: (e as Error).message, isError: true };
    }
  },
});
