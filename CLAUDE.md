# fluffdesk

给悉尼个体宠物美容店用的预约 agent。客人从美容店的各个入口发来询价，agent 认出宠物、按店里的价目表报价、查空档，挂一个待确认预约，美容师确认后才算数。界面中英双语。

## 技术栈
- 全仓 TypeScript，npm workspaces 单仓：`apps/api`（Hono）、`apps/web`（Next.js）、`packages/core`、`packages/db`、`packages/eval`
- 模型层用 pi-ai（`@earendil-works/pi-ai`）做多 provider 网关；agent 循环、工具和 eval 自己写，不用 agent 框架
- 模型角色由环境变量指定（`FLUFF_CHAT_MODEL` 等），demo 阶段走 Claude API 额度，DeepSeek 做第二家和降级
- 前端 Next.js，美容师端做成 PWA（Web Push 通知，邮件兜底）
- 数据：Postgres（Neon 悉尼区，Drizzle）；部署 Vercel + Fly.io 悉尼区。存储实现在 `packages/db`，路由和渠道层只认 `packages/core` 里的端口接口（`ShopRepo`、`ConversationStore`、`BookingStore`、`CorrectionStore`）；没配 `DATABASE_URL` 走内存版，生产必须配
- 开发尽量用 Claude Code 原生能力；需要 skill/MCP 时在仓库里自建，不装第三方

## 规矩
- 写日历、改预约这类写操作，必须等美容师确认才执行。agent 只能挂 PENDING，确认接口在美容师端
- 报价只给区间，注明以到店评估为准，不能超出价目表。区间由 `quote` 工具按店铺配置算出，模型只能引用工具结果
- agent 核心不依赖渠道：托管聊天页、嵌入小窗、Instagram、WhatsApp 各写一个适配层（`apps/api/src/channels`）
- 店铺资料是一份独立配置（`packages/core/src/shop/schema.ts`），导入器从公开信息填它，美容师端改它，agent 只读它
- 美容师对识图结果和报价的修正都要记下来，作为 eval 集（`packages/eval/datasets`）
- 每次对话有完整轨迹：每步模型调用、工具调用、耗时、成本，属性名按 OpenTelemetry GenAI 约定
- v1 不碰支付；客人数据存悉尼区；密钥不进仓库
- 公网进来的东西都有上限（`packages/core/src/agent/limits.ts`）：图片数量和大小、会话长度、每会话待确认预约数、每 IP 和每会话请求频率
- 美容师端接口过渡期用 `GROOMER_API_TOKEN` 做 Bearer 鉴权，没配就 503，正式方案是 magic link
- 导入器抓任何 URL 都走 `safeFetchHtml`：只许 http(s)、拒内网地址、重定向逐跳校验、正文限 2MB

## 测试纪律（细节和理由见 docs/adr/0001-testing-strategy.md）
- 改任何代码：`npm test` 必过；改了核心逻辑再跑 `npm run test:mutate`，逃掉一条就不算完
- 改抽取或合并逻辑：用 Fenny & Jacks 重跑 `npm run import` 当回归
- 改提示词、工具定义或换模型：`npm run eval -- quote --record` 重新录制，再 `--replay` 确认 CI 能过；回放指纹对不上就是要重录，不要改指纹
- 新护栏规矩先写契约测试再写实现：业务规矩放 `packages/core/test/guardrails.test.ts`，公网输入的上限和 SSRF 放 `packages/core/test/security.test.ts`，HTTP 边界放 `apps/api/test/routes.test.ts`，数据层（只有 pending 能 decide、未确认的店 agent 看不到、图片只追加）放 `packages/db/test/stores.test.ts`，用 PGlite 离线跑，CI 不需要数据库
- 改 `packages/db/src/schema.ts` 后必须 `npm run db:generate -w packages/db` 生成迁移并一起提交，不手改 `migrations/`
- 不写断言实现常数的测试，不 mock 被测对象，CI 里不调真模型

## PR 流程
代码写完、提交干净 → `/pr-review` → 它问一次"推不推"→ 推、开 PR、CI 绿、合并。细则在 `.claude/skills/pr-review/SKILL.md`，原则和理由在 docs/adr/0002-review-loop.md。人只看每轮的摘要和最后的报告，不参与循环，修也由 agent 做。
- 先自证再审：门禁命令全绿、改动路径实际走过（页面用 Claude in Chrome 把每个流程走到尾、查控制台和网络、录 GIF 当证据；接口用 curl）、按路径表定风险档，证据进 PR 模板（`.github/pull_request_template.md`）。diff 超过 40 个文件或 1500 行（不算 vendored 和生成文件）先拆 PR。
- 审查者全是全新上下文：`/test-review`（fork 子代理）、`/code-review <级别> <范围>`、`/security-review`（增量轮自己派识别和过滤子代理）。作者只分诊和修。
- 分诊是机械规则：high、important、安全保留项只能修，或经独立复核子代理同意后否决；纯风格丢弃；一轮的修复合成一个提交，这个提交就是下一轮的范围。
- 先复现再修：后端先写会红的测试，前端写复现步骤并点出来；复现不了的否决并记进 `docs/reviews/dismissed.md`。同一文件连续两轮出现在修复提交里，第三轮不许再打补丁。
- 停止：一轮没有新的 high 或 important、没有 ≥8 的安全项、没有必须改。轮数上限三轮；每个改代码的修复提交都会被下一轮或一次"补审"审到，没人审的代码不推；第三轮的修复补审后仍有 high 或 important、或卡住（同一条修两次仍在、修复引入 high、同文件连改两轮后剩下的 high 不做结构性改法）就交给人拍板。状态机和"引入"的判定只写在 skill 里，这里不复述。
- 循环里不改 agent 自己的配置（CLAUDE.md、`.claude/**`、ADR、PR 模板）。和以前 PR 同类的发现、以及针对配置文件的发现，都追加进 `docs/reviews/recurring-findings.md` 等人逐条审，不自己改规矩。例外：PR 的交付物本身是这些规则（人明确要求改流程）时，规则文本的发现照常修。
- 第一轮审整个 PR（`origin/main...HEAD`），之后只审新提交；审查后又加的任何提交（文档也算）合并前补审。漏了审查就在合并后的 diff 上补跑并开修复 PR。

## 设计系统
- 正本在 `packages/design/project/`（Design System 目录格式）：`tokens.json` 是唯一的值来源，`npm run design:build` 生成 `apps/web/app/tokens.css`（提交进仓库，Vercel 单独构建拿不到 workspace）和 `project/components/bundle.css`；CI 跑 `design:check` 保证同步。改颜色字体只改 tokens.json，改组件样式只改 `apps/web/app/globals.css`，不手改生成文件
- 颜色和字体来自 Eirlys 规范；其余按 `.claude/skills/design-taste-frontend` 的 app-screen 规则（风格 framed-sheet，sheet 在 `.taste-skill/direction.json`，`draw.mjs --show` 重印）。做新屏幕先读 `references/app-screens.md`，做完跑 `inspect.mjs --app` 到 0 FAIL
- 设计系统的可浏览版是一个 Design System artifact（链接在 docs/design-system.md），改完 `packages/design/project/` 后重新发布

## 常用命令
`npm run typecheck`、`npm test`（离线）、`npm run test:mutate`、`npm run design:build`、`npm run design:check`、`npm run eval -- quote [--record|--replay|--runs 3]`、`npm run import -- --slug x ...`、`npm run db:migrate`、`npm run db:seed`、`npm run dev:api`、`npm run dev:web`、`npm run deploy:api`、`npm run deploy:web`（都只许从和 origin/main 一致的干净 main 发）
