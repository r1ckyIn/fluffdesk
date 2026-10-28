import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { ShopConfig } from "@fluffdesk/core";
import { createRuntime, type Runtime } from "./runtime.js";
import { chatRoutes } from "./routes/chat.js";
import { groomerRoutes } from "./routes/groomer.js";
import { webhookRoutes } from "./routes/webhooks.js";

/** shop 只在 /groomer/:shop/* 的中间件里设，别处没有 */
export type AppEnv = { Variables: { rt: Runtime; shop?: ShopConfig } };

/** 请求体上限：一轮最多 3 张图，每张 base64 2MB，再留点余量 */
const BODY_LIMIT_BYTES = 7 * 1024 * 1024;

export function createApp(runtime?: Runtime, env: Record<string, string | undefined> = process.env) {
  const rt = runtime ?? createRuntime(env);
  const origin = env.WEB_ORIGIN;
  // 生产环境必须指定前端来源；没配就起不来，不能默认放开
  if (env.NODE_ENV === "production" && !origin) throw new Error("WEB_ORIGIN must be set in production");

  const app = new Hono<AppEnv>();
  app.use("*", secureHeaders());
  app.use("*", cors({ origin: origin ?? "*" }));
  app.use("*", bodyLimit({ maxSize: BODY_LIMIT_BYTES, onError: (c) => c.json({ error: "request too large" }, 413) }));
  app.use("*", async (c, next) => {
    c.set("rt", rt);
    await next();
  });
  // 错误不往外吐细节：provider 的报错信息里可能有模型名、配额之类的东西
  app.onError((err, c) => {
    console.error(`[api] ${c.req.method} ${c.req.path}:`, err);
    return c.json({ error: "internal error" }, 500);
  });
  // 列店要查库：库挂了 health 就红，这是想要的
  app.get("/health", async (c) => c.json({ ok: true, shops: (await rt.shops.list()).map((s) => s.slug) }));
  app.route("/chat", chatRoutes);
  app.route("/groomer", groomerRoutes(env));
  app.route("/webhooks", webhookRoutes(env));
  return app;
}
