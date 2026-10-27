import { ToolRegistry } from "./registry.js";
import { quoteTool, computeQuote } from "./quote.js";
import { identifyPetTool } from "./identify_pet.js";
import { availabilityTool } from "./availability.js";
import { holdBookingTool } from "./hold_booking.js";

export { quoteTool, computeQuote, identifyPetTool, availabilityTool, holdBookingTool };

/** 标准工具集。注意这里没有任何 write 级工具 */
export function defaultTools(): ToolRegistry {
  return new ToolRegistry().register(quoteTool).register(identifyPetTool).register(availabilityTool).register(holdBookingTool);
}
