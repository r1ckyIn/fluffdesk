import { describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createGateway } from "../src/llm/gateway.js";
import { newConversation, runTurn, type AgentDeps } from "../src/agent/loop.js";
import { defaultTools } from "../src/tools/index.js";
import { InMemoryBookingStore, InMemoryCalendar } from "../src/booking/ports.js";
import { demoShop } from "./fixtures.js";

function setup() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const gateway = createGateway({ models, roleModels: { chat: model, vision: model, judge: model, fallback: model } });
  const bookings = new InMemoryBookingStore();
  const calendar = new InMemoryCalendar(() => ({ open: "09:00", close: "17:00" }));
  const deps: AgentDeps = { gateway, shop: demoShop, tools: defaultTools(), toolContext: { bookings, calendar }, today: () => "2026-11-01" };
  return { faux, deps, bookings };
}

describe("runTurn", () => {
  it("runs quote tool then replies, and records the tool call", async () => {
    const { faux, deps } = setup();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("quote", { serviceId: "full-groom", size: "medium" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("A full groom for a medium dog is AUD 120-160. Final price is assessed in store.")]),
    ]);
    const conv = newConversation({ id: "c1", shopSlug: demoShop.slug, channel: "web", locale: "en" });
    const res = await runTurn(deps, conv, { text: "How much for a full groom for my 15kg spoodle?" });
    expect(res.stop).toBe("done");
    expect(res.reply).toContain("120-160");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toMatchObject({ name: "quote", isError: false, details: { min: 120, max: 160 } });
    expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
  });

  it("hold_booking only creates a pending booking", async () => {
    const { faux, deps, bookings } = setup();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("hold_booking", {
        customerName: "Amy", contact: "0400000000", serviceId: "bath-tidy", start: "2026-11-02T10:00",
        pet: { species: "dog", sizeTier: "small", breedGuess: "poodle" },
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Request sent, the groomer will confirm shortly.")]),
    ]);
    const conv = newConversation({ id: "c2", shopSlug: demoShop.slug, channel: "web", locale: "zh" });
    const res = await runTurn(deps, conv, { text: "周日10点可以，叫Amy，电话0400000000" });
    expect(res.stop).toBe("done");
    const pending = await bookings.listPending(demoShop.slug);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ status: "pending", quote: { min: 60, max: 80 } });
  });

  it("returns a validation error to the model instead of crashing on bad args", async () => {
    const { faux, deps } = setup();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("quote", { serviceId: "full-groom" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Could you tell me your dog's weight?")]),
    ]);
    const conv = newConversation({ id: "c3", shopSlug: demoShop.slug, channel: "web", locale: "en" });
    const res = await runTurn(deps, conv, { text: "price?" });
    expect(res.toolCalls[0]?.isError).toBe(true);
    expect(res.reply).toContain("weight");
  });

  it("stops at maxIterations and hands off", async () => {
    const { faux, deps } = setup();
    const loop = fauxAssistantMessage([fauxToolCall("check_availability", { date: "2026-11-03", serviceId: "bath-tidy" })], { stopReason: "toolUse" });
    faux.setResponses([loop, loop, loop, loop]);
    const conv = newConversation({ id: "c4", shopSlug: demoShop.slug, channel: "web", locale: "en" });
    const res = await runTurn({ ...deps, maxIterations: 3 }, conv, { text: "when?" });
    expect(res.stop).toBe("max_iterations");
    expect(res.toolCalls).toHaveLength(3);
    expect(res.reply).toMatch(/groomer/);
  });
});
