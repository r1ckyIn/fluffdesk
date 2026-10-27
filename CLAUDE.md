# fluffdesk

给悉尼个体宠物美容店用的预约 agent。客人从美容店的各个入口发来询价，agent 认出宠物、按店里的价目表报价、查空档，挂一个待确认预约，美容师确认后才算数。界面中英双语。

## 技术栈
- 全仓 TypeScript，npm workspaces 单仓：`apps/api`（Hono）、`apps/web`（Next.js）、`packages/core`、`packages/db`、`packages/eval`
- 模型层用 pi-ai（`@earendil-works/pi-ai`）做多 provider 网关；agent 循环、工具和 eval 自己写，不用 agent 框架
- 模型角色由环境变量指定（`FLUFF_CHAT_MODEL` 等），demo 阶段走 Claude API 额度，DeepSeek 做第二家和降级
- 前端 Next.js，美容师端做成 PWA（Web Push 通知，邮件兜底）
- 数据：Postgres（Neon 悉尼区，Drizzle）；部署 Vercel + Fly.io 悉尼区
- 开发尽量用 Claude Code 原生能力；需要 skill/MCP 时在仓库里自建，不装第三方

## 规矩
- 写日历、改预约这类写操作，必须等美容师确认才执行。agent 只能挂 PENDING，确认接口在美容师端
- 报价只给区间，注明以到店评估为准，不能超出价目表。区间由 `quote` 工具按店铺配置算出，模型只能引用工具结果
- agent 核心不依赖渠道：托管聊天页、嵌入小窗、Instagram、WhatsApp 各写一个适配层（`apps/api/src/channels`）
- 店铺资料是一份独立配置（`packages/core/src/shop/schema.ts`），导入器从公开信息填它，美容师端改它，agent 只读它
- 美容师对识图结果和报价的修正都要记下来，作为 eval 集（`packages/eval/datasets`）
- 每次对话有完整轨迹：每步模型调用、工具调用、耗时、成本，属性名按 OpenTelemetry GenAI 约定
- v1 不碰支付；客人数据存悉尼区；密钥不进仓库

## 常用命令
`npm run typecheck`、`npm test`（离线 faux 模型）、`npm run dev:api`、`npm run dev:web`、`npm run eval -- <dataset>`
