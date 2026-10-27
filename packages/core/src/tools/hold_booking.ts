import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "./registry.js";
import { findService } from "../shop/schema.js";
import { computeQuote } from "./quote.js";
import type { CoatType } from "../shop/schema.js";

/**
 * 唯一的 propose 级工具：挂一个 pending 预约。
 * 它不写日历、不通知客人"预约成功"，只是把请求放进待确认队列。
 */
export const holdBookingTool = defineTool({
  permission: "propose",
  definition: {
    name: "hold_booking",
    description:
      "Place a PENDING booking request for the groomer to confirm. Only call after the customer agreed on service, " +
      "time and gave a name and contact. Tell the customer the groomer will confirm; never say it is booked.",
    parameters: Type.Object({
      customerName: Type.String(),
      contact: Type.String({ description: "phone, email or channel handle" }),
      serviceId: Type.String(),
      start: Type.String({ description: "ISO datetime without timezone, e.g. 2026-11-02T10:00" }),
      pet: Type.Object({
        name: Type.Optional(Type.String()),
        species: Type.String({ description: "dog|cat|other" }),
        breedGuess: Type.Optional(Type.String()),
        sizeTier: Type.Optional(Type.String()),
        coat: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
      }),
    }),
  },
  async run(args, ctx) {
    const service = findService(ctx.shop, args.serviceId);
    if (!service) return { text: `unknown service ${args.serviceId}`, isError: true };
    let quote: { min: number; max: number; currency: "AUD" } | undefined;
    if (args.pet.sizeTier) {
      try {
        const q = computeQuote(ctx.shop, args.serviceId, args.pet.sizeTier, args.pet.coat as CoatType | undefined);
        quote = { min: q.min, max: q.max, currency: q.currency };
      } catch {
        /* 没有价目就不带报价 */
      }
    }
    const species = (["dog", "cat"].includes(args.pet.species) ? args.pet.species : "other") as "dog" | "cat" | "other";
    const booking = await ctx.bookings.createPending({
      shopSlug: ctx.shop.slug,
      conversationId: ctx.conversationId,
      customer: { name: args.customerName, contact: args.contact, channel: ctx.channel },
      pet: { ...args.pet, species },
      serviceId: args.serviceId,
      start: args.start,
      durationMin: service.durationMin,
      quote,
    });
    return {
      text: `pending booking ${booking.id} created for ${args.start}. The groomer will confirm; tell the customer to expect confirmation.`,
      details: { bookingId: booking.id, status: booking.status, start: booking.start },
    };
  },
});
