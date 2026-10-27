import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "./registry.js";
import { findService } from "../shop/schema.js";

export const availabilityTool = defineTool({
  permission: "read",
  definition: {
    name: "check_availability",
    description: "List free appointment slots on a date for a service. Dates are in the shop's timezone.",
    parameters: Type.Object({
      date: Type.String({ description: "YYYY-MM-DD" }),
      serviceId: Type.String(),
    }),
  },
  async run(args, ctx) {
    const service = findService(ctx.shop, args.serviceId);
    if (!service) return { text: `unknown service ${args.serviceId}`, isError: true };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) return { text: "date must be YYYY-MM-DD", isError: true };
    const slots = await ctx.calendar.freeSlots(args.date, service.durationMin);
    if (slots.length === 0) return { text: `no free slots on ${args.date}`, details: { date: args.date, slots: [] } };
    const shown = slots.slice(0, 6);
    return {
      text: `free slots on ${args.date}: ${shown.map((s) => s.start.slice(11)).join(", ")}${slots.length > 6 ? " (more available)" : ""}`,
      details: { date: args.date, slots: shown.map((s) => ({ ...s })) },
    };
  },
});
