import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // 测试直接跑 src，不走 dist。否则 dist 不重建时测的是旧代码，变异脚本对回放层也没有检测力
    alias: {
      "@fluffdesk/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@fluffdesk/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // 一个 PGlite 实例启动就要 ~650MB，db 的两个测试文件并行时整体峰值 2GB，7GB 的开发机会 OOM；
    // 串行跑峰值 1.2GB，多花两三秒。变异脚本会连跑二十多次，更要省
    maxWorkers: 1,
  },
});
