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

## TODO

按优先级排。打勾的是做完并验证过的。

### 导入器（销售第一段：免费 demo）
- [x] 抽取器：strict tool use + 本地校验 + 原文核对，三次重试
- [x] 官网 / Google 商家 / Instagram 截图三路导入，按信息量合并
- [x] 第一家真实店铺（Fenny & Jacks）导入通过，分档价目和店家预约页一致
- [ ] 改抽取或合并逻辑后，用 Fenny & Jacks 重跑一遍当回归（七个服务、六档价目、营业时间周一到周六）
- [ ] 预约页来源：Timely、Fresha 这类公开预约页，信息比官网准
- [ ] 服务时长：来源没写时别用 60 分钟占位，标成缺失让人填
- [ ] policies 抽取：取消政策、不接的品种、打结加价这些进 notes
- [ ] 草稿确认流：美容师端看草稿、改字段、点确认后进 shops 表

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
- [ ] 登录（magic link）
- [ ] 待确认列表，一键确认/拒绝，拒绝给替代时间
- [ ] 修正识图和报价
- [ ] Web Push 通知，邮件兜底

### 数据与部署
- [ ] runtime.ts 从内存实现换成 @fluffdesk/db（Neon 悉尼区），跑一次 migration
- [ ] 对话、预约、轨迹、修正落库
- [ ] Fly.io 悉尼区部署 api，Vercel 部署 web
- [ ] 第二家模型（DeepSeek）跑一遍同一测试集做对比

### 付费验证（销售第二段）
- [ ] 让店家导出两周 Instagram 私信，离线回放，量"本来会丢掉的询价"有多少
- [ ] 影子模式：agent 只写草稿，老板发送
