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
npm run dev:api          # http://localhost:8787/health；没配 DATABASE_URL 走内存存储（重启丢）
npm run dev:web          # http://localhost:3000
npm run eval -- quote    # 真模型跑 eval（花钱）
npm run eval -- quote --replay   # 按录制回放，不花钱，CI 用
npm run eval -- quote --record   # 改了提示词或工具后重新录制
npm run eval -- quote --runs 3   # pass^3
npm run test:mutate      # 变异测试，看护栏在不在
npm run import -- --slug fenny-and-jacks --website <url> --google "<店名>" --screenshots imports/fenny-and-jacks
```

测试分四层（单元、契约、录制回放 e2e、eval），为什么这么分见 `docs/adr/0001-testing-strategy.md`。

## TODO

按优先级排。打勾的是做完并验证过的。

### 导入器（销售第一段：免费 demo）
- [x] 抽取器：strict tool use + 本地校验 + 原文核对，三次重试
- [x] 官网 / Google 商家 / Instagram 截图三路导入，按信息量合并
- [x] 第一家真实店铺（Fenny & Jacks）导入通过，分档价目和店家预约页一致
- [ ] 预约页来源：Timely、Fresha 这类公开预约页，信息比官网准
- [ ] 服务时长：来源没写时别用 60 分钟占位，标成缺失让人填
- [ ] policies 抽取：取消政策、不接的品种、打结加价这些进 notes
- [ ] 草稿确认流：美容师端看草稿、改字段、点确认后进 shops 表

### 测试与 eval
- [x] 契约测试守 CLAUDE.md 规矩；变异脚本 9 条；CI 门禁
- [x] 录制回放：eval 集 24 条用真模型录制，CI 回放
- [ ] eval 集加真实客人案例（老板导出私信后）；一直全绿的用例降频
- [ ] 模型评审和人工打分对齐（75% 以上），再启用 judge
- [ ] 自建 `.claude/skills/test-review`：把 ADR 的"不做什么"做成 PR 前的 review 清单，守测试的写法（CI 只能守结果）
- [ ] 新加核心逻辑时同步往 `scripts/mutate.sh` 加变异，否则护栏没人验
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
- [ ] 登录（magic link），替掉过渡期的共享 `GROOMER_API_TOKEN`，并把人绑到店
- [ ] 待确认列表，一键确认/拒绝，拒绝给替代时间
- [ ] 修正识图和报价
- [ ] Web Push 通知，邮件兜底

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
- [ ] Neon：建 dev 分支给本地用，main 设受保护；API 用只有 DML 的角色，owner 角色只跑迁移
- [ ] 多实例时会话锁和限流要从进程内换到数据库（现在单实例）
- [ ] Fly.io 悉尼区部署 api，Vercel 部署 web
- [ ] 第二家模型（DeepSeek）跑一遍同一测试集做对比

### 付费验证（销售第二段）
- [ ] 让店家导出两周 Instagram 私信，离线回放，量"本来会丢掉的询价"有多少
- [ ] 影子模式：agent 只写草稿，老板发送
