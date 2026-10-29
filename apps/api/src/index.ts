import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createRuntime } from "./runtime.js";

const port = Number(process.env.PORT ?? 8787);
const rt = createRuntime(process.env);
const app = createApp(rt, process.env);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`fluffdesk api listening on http://localhost:${info.port}`);
});

/**
 * Fly 停机先发 SIGTERM：停收新连接，等在飞的请求和后台的渠道轮次跑完（模型已经调了，会话还没存），再关连接池。
 * 等不到就硬退，上限要比 fly.toml 的 kill_timeout 短；一轮模型十几秒，所以留 25 秒
 */
const SHUTDOWN_GRACE_MS = 25_000;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    const deadline = setTimeout(() => {
      console.error(`[api] in-flight requests did not finish within ${SHUTDOWN_GRACE_MS}ms, exiting`);
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();
    server.close(() => {
      rt.close().finally(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
  });
}
