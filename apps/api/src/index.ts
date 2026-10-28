import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createRuntime } from "./runtime.js";

const port = Number(process.env.PORT ?? 8787);
const rt = createRuntime(process.env);
const app = createApp(rt, process.env);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`fluffdesk api listening on http://localhost:${info.port}`);
});

// Fly 停机先发 SIGTERM：停收新请求，关掉连接池再退出
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    rt.close().finally(() => process.exit(0));
  });
}
