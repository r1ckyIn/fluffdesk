# fluffdesk

悉尼个体宠物美容店的预约 agent。项目说明见 `CLAUDE.md`。

## 目录

```
apps/api        Node + Hono 后端：渠道适配、美容师端接口、webhook（部署 Fly.io 悉尼区）
apps/web        Next.js：客人聊天页、嵌入小窗、美容师 PWA（部署 Vercel）
packages/core   agent 核心：店铺配置、模型网关、循环、工具、轨迹。不依赖渠道、不依赖数据库
packages/db     Postgres 表结构与客户端（Drizzle，Neon 悉尼区）
packages/eval   测试集、跑分脚本、评分器
```

## 开发

```bash
cp .env.example .env     # 填 key
npm install
npm run typecheck
npm test                 # 离线，用 faux provider，不花钱
npm run dev:api          # http://localhost:8787/health
npm run dev:web          # http://localhost:3000
npm run eval -- quote    # 跑一个测试集
```
