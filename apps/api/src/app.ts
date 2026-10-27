import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRuntime, type Runtime } from "./runtime.js";
import { chatRoutes } from "./routes/chat.js";
import { groomerRoutes } from "./routes/groomer.js";
import { webhookRoutes } from "./routes/webhooks.js";

export type AppEnv = { Variables: { rt: Runtime } };

export function createApp(rt: Runtime = createRuntime()) {
  const app = new Hono<AppEnv>();
  app.use("*", cors({ origin: process.env.WEB_ORIGIN ?? "*" }));
  app.use("*", async (c, next) => {
    c.set("rt", rt);
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, shops: rt.shops.list().map((s) => s.slug) }));
  app.route("/chat", chatRoutes);
  app.route("/groomer", groomerRoutes);
  app.route("/webhooks", webhookRoutes);
  return app;
}
