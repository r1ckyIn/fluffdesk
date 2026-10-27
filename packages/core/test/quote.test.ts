import { describe, expect, it } from "vitest";
import { computeQuote } from "../src/tools/quote.js";
import { sizeTierForKg } from "../src/shop/schema.js";
import { demoShop } from "./fixtures.js";

describe("computeQuote", () => {
  it("returns the exact range from the price list", () => {
    const q = computeQuote(demoShop, "full-groom", "medium");
    expect(q).toMatchObject({ min: 120, max: 160, currency: "AUD", durationMin: 120 });
  });
  it("prefers a coat-specific rule when one exists", () => {
    expect(computeQuote(demoShop, "full-groom", "large", "double")).toMatchObject({ min: 190, max: 260 });
    expect(computeQuote(demoShop, "full-groom", "large", "curly")).toMatchObject({ min: 160, max: 220 });
  });
  it("rejects unknown services and sizes", () => {
    expect(() => computeQuote(demoShop, "nope", "small")).toThrow(/unknown service/);
    expect(() => computeQuote(demoShop, "full-groom", "xl")).toThrow(/unknown size/);
  });
  it("maps weight to tiers", () => {
    expect(sizeTierForKg(demoShop, 4).id).toBe("small");
    expect(sizeTierForKg(demoShop, 25).id).toBe("medium");
    expect(sizeTierForKg(demoShop, 40).id).toBe("large");
  });
});
