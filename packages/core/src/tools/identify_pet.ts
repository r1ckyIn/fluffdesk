import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "./registry.js";

/**
 * 识图走 vision 角色的模型，单独一次调用，返回结构化猜测。
 * 结果永远是"猜测"，报价时按猜测的体型档，到店再评估。
 */
export const identifyPetTool = defineTool({
  permission: "read",
  definition: {
    name: "identify_pet",
    description:
      "Look at a photo the customer sent and estimate species, breed, size tier and coat type. " +
      "Use the returned sizeTier and coat when calling quote. Treat the result as a guess.",
    parameters: Type.Object({
      imageId: Type.String({ description: "id of an image attached in this conversation" }),
    }),
  },
  async run(args, ctx) {
    const img = ctx.images.get(args.imageId);
    if (!img) return { text: `no image with id ${args.imageId}`, isError: true };
    const tiers = ctx.shop.sizeTiers.map((t) => `${t.id}${t.maxKg ? ` (<=${t.maxKg}kg)` : ""}`).join(", ");
    const res = await ctx.gateway.complete("vision", {
      systemPrompt:
        "You identify pets for a grooming salon. Reply with JSON only: " +
        '{"species":"dog|cat|other","breedGuess":string,"sizeTier":string,"coat":"short|double|curly|wire|long","confidence":0-1,"notes":string}. ' +
        `sizeTier must be one of: ${tiers}.`,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Identify this pet." },
            { type: "image", data: img.data, mimeType: img.mimeType },
          ],
          timestamp: Date.now(),
        },
      ],
    }, { maxTokens: 300 });
    if (res.stopReason === "error") return { text: `vision model error: ${res.errorMessage ?? "unknown"}`, isError: true };
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return { text: `could not parse identification: ${text}`, isError: true };
    try {
      const parsed = JSON.parse(json);
      return { text: JSON.stringify(parsed), details: parsed };
    } catch {
      return { text: `could not parse identification: ${text}`, isError: true };
    }
  },
});
