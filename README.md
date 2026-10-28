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
npm run db:migrate       # 把 packages/db/migrations 里没跑过的迁移跑到 DATABASE_URL（Neon）
npm run db:seed          # 把 packages/eval/datasets/shops.json 的 demo 店 upsert 进 shops 表
npm run db:app-role -w packages/db -- production   # 用 owner 串建只有 DML 的 fluffdesk_app，app 串写到 ~/.config/fluffdesk/production-app.url
npm run dev:api          # http://localhost:8787/health；没配 DATABASE_URL 走内存存储（重启丢）
npm run dev:web          # http://localhost:3000
npm run deploy:api       # 发 api 到 Fly：要求干净的 main、和 origin/main 一致、CI 绿、只有 1 台机器；远程构建，部署前自动跑迁移
npm run deploy:web       # 发 web 到 Vercel 生产：同样的 main 检查，CLI 钉版本
npm run eval -- quote    # 真模型跑 eval（花钱）
npm run eval -- quote --replay   # 按录制回放，不花钱，CI 用
npm run eval -- quote --record   # 改了提示词或工具后重新录制
npm run eval -- quote --runs 3   # pass^3
npm run test:mutate      # 变异测试，看护栏在不在
npm run import -- --slug fenny-and-jacks --website <url> --google "<店名>" --screenshots imports/fenny-and-jacks
```

测试分四层（单元、契约、录制回放 e2e、eval），为什么这么分见 `docs/adr/0001-testing-strategy.md`。

## TODO

打勾的是做完并验证过的。

### 下一步的顺序（2026-10-28 定）
1. ~~Fly 部署 api + Vercel 部署 web~~（2026-10-28 都已上线）
2. ~~美容师端：待确认列表、一键确认/拒绝~~（2026-10-28 做完，分支 chore/taste-skill）；magic link 登录换掉共享 token 还没做，等域名（fluffdesk.eirlys.ai）和 Resend 账号
3. Instagram 和 WhatsApp 收发消息；Meta 应用审核要排队，和第 2 步并行提交
4. PR 级 e2e（Neon 分支）：API key 和 NEON_PROJECT_ID 已在 GitHub，等冒烟脚本
5. 模型评审和人工打分对齐：等有真客人对话再做，对着假数据对齐没意义

下面按模块分。

### 导入器（销售第一段：免费 demo）
- [x] 抽取器：strict tool use + 本地校验 + 原文核对，三次重试
- [x] 官网 / Google 商家 / Instagram 截图三路导入，按信息量合并
- [x] 第一家真实店铺（Fenny & Jacks）导入通过，分档价目和店家预约页一致
- [ ] 预约页来源：Timely、Fresha 这类公开预约页，信息比官网准
- [ ] 服务时长：来源没写时别用 60 分钟占位，标成缺失让人填
- [ ] 合并时价目的 size 要落到选中的体型档上：抽取结果里的 `all` 之类要展开成每一档或记进 missing，不然 `validateShopConfig` 在 seed/upsert 时整店拒掉（Fenny & Jacks 草稿里 wash-dry 就是 size=all；chore/taste-skill 第 2 轮审查）
- [ ] policies 抽取：取消政策、不接的品种、打结加价这些进 notes
- [ ] 草稿确认流：美容师端看草稿、改字段、点确认后进 shops 表

### 测试与 eval
- [x] 契约测试守 CLAUDE.md 规矩；变异脚本 9 条；CI 门禁
- [x] 录制回放：eval 集 24 条用真模型录制，CI 回放
- [ ] eval 集加真实客人案例（老板导出私信后）；一直全绿的用例降频
- [ ] 模型评审和人工打分对齐（75% 以上），再启用 judge
- [x] 自建 `.claude/skills/test-review`（守测试写法）和 `.claude/skills/pr-review`（审查循环，ADR 0002）
- [ ] 新加核心逻辑时同步往 `scripts/mutate.sh` 加变异，否则护栏没人验
- [ ] 浏览器走查通过的关键流程（美容师端确认/拒绝、聊天页询价）改写成 Playwright e2e 放进 CI，Chrome 负责探索，Playwright 负责防回归
- [ ] 改抽取或合并逻辑后，用 Fenny & Jacks 重跑当回归（七个服务、六档价目、营业时间周一到周六）

### agent 核心
- [x] 自写循环、四个工具、pending 预约、轨迹
- [ ] `hold_booking` 对接外部预约系统（Timely API 或直达链接），有系统的店不用我们的队列
- [ ] 识图结果和报价的修正回流到 corrections，再导出成 eval 用例
- [ ] 模型评审和人工打分对齐（目标一致率 75% 以上）

### 渠道
- [x] 托管聊天页接口
- [ ] 嵌入小窗（iframe 版聊天页）
- [ ] Instagram Messaging API：验签、收消息、回消息
- [ ] WhatsApp Cloud API：同上

### 美容师端（PWA）
- [ ] ShopForm 的"行来自已保存资料"标记现在是和 draft 并行的布尔数组，四个 handler 手工对齐；改成标记跟着行走（行上带 `_saved`，normalise 时剥掉）（chore/taste-skill 第 2 轮审查）
- [x] 过渡期登录：店铺 id + 名字 + 共享 `GROOMER_API_TOKEN` 存本机浏览器，401 自动退出
- [x] 待确认列表，一键确认/拒绝，拒绝从空档里挑最多 3 个替代时间（`bookings.alternatives`，迁移 0002）
- [x] 详情看客人对话和照片（`GET /groomer/:shop/conversations/:id`，图片按 id 另取），当天安排条（已确认减掉空档）
- [x] 修正识图和报价（写 corrections）
- [x] 已处理列表（`?status=decided`），店铺资料编辑（`PUT /groomer/:shop/shop`，整份过 schema）
- [x] 中英双语、手机布局（侧栏折成底栏）、tasteskill framed-sheet 壳子、Eirlys 色板和字体
- [x] 设计系统：`packages/design/`（tokens.json 正本 → `apps/web/app/tokens.css` 和组件预览），artifact 见 docs
- [ ] 登录（magic link，better-auth + Resend），替掉共享 token，把人绑到店；要先把 web/api 挂到 `fluffdesk.eirlys.ai` 子域（Cloudflare）让 cookie 同站
- [ ] Web Push 通知（`web-push` + VAPID），邮件兜底（和 magic link 共用 Resend）
- [ ] confirmed / declined 之后通知客人（web 渠道要轮询或推送；IG/WA 等渠道接入）
- [ ] 修正报价后"重新报价"给客人（现在只记 corrections，不改预约）
- [ ] 用 tasteskill `inspect.mjs --app` 对三个屏幕跑一轮检查并修到 0 FAIL（脚本要在本机跑）

### 安全（PR #1 的安全审查发现，已修）
- [x] 美容师端鉴权（过渡：Bearer token，没配 503）、修正记录按字段构造
- [x] 聊天接口：请求体 7MB 上限、图片数量/类型/大小校验、sessionId 格式、每 IP 和每会话限流、错误不外泄
- [x] 会话存储有界（5000 个、24 小时）、会话消息上限、旧图片裁掉
- [x] 导入器防 SSRF、webhook 握手失败关闭并常数时间比较、CLI slug 校验、CORS 生产必须配、Dockerfile 非 root、CI 锁 SHA
- [ ] WhatsApp / Instagram POST webhook 验签（接渠道时一起做）
- [ ] DNS rebinding：上线后在 Fly 出口网络层再拦一道内网地址

### 数据与部署
- [x] runtime.ts 按 DATABASE_URL 切换到 @fluffdesk/db（Neon 悉尼区），迁移文件进仓库，部署前 release_command 跑迁移
- [x] 店铺、对话（含图片）、预约、轨迹、修正落库；decide 原子更新；同一会话并发轮次串行
- [x] 闲置 24 小时的会话清掉图片（表里的行和消息里内嵌的），文字历史留着
- [ ] 改 schema 后 `npm run db:generate -w packages/db` 重新生成迁移并提交，不手改 migrations/
- [ ] 图片按需加载：现在每轮把会话的全部图片读进内存给 identify_pet 用，图多了要改成只读 id、工具用到再取
- [ ] 会话文字历史的保留期限（产品决定，和 eval 集的需要一起定）
- [x] Neon：本地只连 dev 分支（`.env` 的 `DATABASE_URL`）；API 用只有 DML 的 `fluffdesk_app`（`db:app-role` 用 SQL 建，控制台建的角色带 neon_superuser）。Free 档没有受保护分支，接受
- [x] Fly secrets 已设（11 个：DATABASE_URL、MIGRATE_DATABASE_URL、ANTHROPIC_API_KEY、DEEPSEEK_API_KEY、四个 FLUFF_*_MODEL、GROOMER_API_TOKEN、WHATSAPP_VERIFY_TOKEN、WEB_ORIGIN）。`WEB_ORIGIN` 已指向 Vercel 正式域名
- [ ] PR 级 e2e：GitHub Action 每个 PR 从 production 建 Neon 分支、跑连真库的冒烟、PR 关了删分支。要项目级 API key 进 GitHub secrets、`NEON_PROJECT_ID` 做 variable；先写冒烟脚本再建 key
- [ ] eval 对着临时 Neon 分支跑，判分直接查库的最终状态（现在查内存存储）
- [x] `hold_booking` 查重：同会话同服务同时段已挂着就回现有的
- [x] `fluffdesk_app` 的权限用例在 PGlite 里跑：能读写、不能 DDL、不能碰 drizzle schema、新表自动授权
- [x] db 测试每条前清空重灌
- [ ] 部署和迁移都挪进 GitHub Action（`push: main` 且 `needs: check`）：CI 绿才发这条规矩就不用本地脚本查 `gh` 了，Fly 的机器上也不用放 owner 串（demo 阶段先接受）
- [ ] 多实例时会话锁和限流要从进程内换到数据库（现在单实例）
- [x] Fly.io 悉尼区部署 api：app `fluffdesk-api`，https://fluffdesk-api.fly.dev，1 台机器（进程内的会话锁和限流不支持多实例：`deploy:api` 用 `--ha=false`，部署前查机器数，多于 1 台就拒，要先 `flyctl scale count 1 -a fluffdesk-api`），release_command 已把迁移 0001 跑到 production
- [x] Vercel 部署 web：项目 `fluffdesk-web`，https://fluffdesk-web.vercel.app，根目录 `apps/web`（单独装依赖，所以 `apps/web/package.json` 要自带 typescript），环境变量 `NEXT_PUBLIC_API_URL` 指向 Fly；发版 `npm run deploy:web`
- [ ] 第二家模型（DeepSeek）跑一遍同一测试集做对比

### 付费验证（销售第二段）
- [ ] 让店家导出两周 Instagram 私信，离线回放，量"本来会丢掉的询价"有多少
- [ ] 影子模式：agent 只写草稿，老板发送
