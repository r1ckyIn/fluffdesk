---
name: pr-review
description: fluffdesk 的 PR 审查循环，代码写完、提交干净之后用。自证（门禁命令 + 实际走一遍改动路径）→ 按风险定级 → 每轮并行跑全新上下文的 test-review / code-review / security-review → 按机械规则分诊、修复成一个提交 → 下一轮只审这个提交，直到一轮没有新的 high 或 important 和 ≥8 的安全项 → 按 PR 模板写报告，问一次推不推。人只看输出，不参与循环。原则见 docs/adr/0002-review-loop.md。
argument-hint: "[基准，默认 origin/main]"
---

# PR 审查循环

基准：`$ARGUMENTS`，空则 `origin/main`。全程不问人任何"修不修、再审不审"的问题；只有第五步推分支那一次要人点头，以及第四步的熔断。每一步做完在聊天里打一行摘要（格式见各步），这是人唯一会看的东西。

## 零、进入条件

全部满足才开始，差一条就先补，不是先审再补：

- `git status --porcelain` 为空；分支领先基准至少一个提交。
- 本轮循环开一个记录文件 `<scratchpad>/pr-review/<分支名>.md`，所有轮次的发现和处理都追加进去，最后生成 PR 描述用。不要放进仓库。

## 一、自证

1. 跑门禁，原样记录每条的结果数字：
   ```
   npm run typecheck
   npm test
   npm run test:mutate
   npm run eval -- quote --replay
   npm run design:check
   ```
   任何一条红：先修，提交，回到零。跑 mutate 前看 `free -h`，可用不到 2GB 先提醒人关会话。
2. 实际走一遍改动的路径，不靠测试替代：接口用 curl 打本地内存模式的 api；页面用 Chrome 开本地 dev 走一遍主流程并截图；迁移在 Neon dev 分支跑过；抽取或合并逻辑改了就重跑 Fenny & Jacks。记下"怎么走的、看到了什么"。
3. 风险定级，看 `git diff --name-only <基准>...HEAD` 命中哪一档，取最高：

   | 档 | 路径 | 后果 |
   |---|---|---|
   | 高 | `apps/api/src/routes/**`、`apps/api/src/app.ts`、`apps/api/src/channels/**`、`packages/core/src/agent/prompt.ts`、`packages/core/src/tools/**`、`packages/core/src/agent/limits.ts`、`packages/core/src/shop/importer/safe-fetch*`、`packages/db/migrations/**`、`packages/db/src/schema.ts`、`packages/db/src/app-role*`、`.github/workflows/**`、`scripts/deploy*`、`scripts/mutate.sh`、`Dockerfile`、`fly.toml`、`packages/eval/graders/**`、`CLAUDE.md`、`.claude/skills/**` | code-review 用 `high`；security 每轮必跑；报告里单列这些文件让人重点看；要写回滚办法 |
   | 中 | 其余 `apps/**/src`、`packages/*/src`、`package.json`、`*.config.*` | code-review 用 `medium`；security 第一轮必跑，之后范围碰到才跑 |
   | 低 | `docs/**`、`README.md`、`packages/design/**`、`apps/web/app/*.css`、`packages/*/test/**`、`packages/eval/datasets/**` | code-review 用 `medium`；security 跳过（skill 本身也排除测试和文档） |

摘要一行：`自证 ✓ typecheck · test n/n · mutate n/n · replay n/n · design ✓ · 路径走过：<一句> · 风险：高（文件 a, b）`

## 二、一轮审查

第 N 轮的范围：N=1 是 `<基准>...HEAD`；N>1 是 `<上一轮审到的 HEAD>..HEAD`。三个审查者都是全新上下文，并行起，等全部回来再分诊。作者（当前上下文）不审查，只等。

- **test-review**：第 1 轮必跑；之后只在范围碰到 `packages/*/test/**`、`packages/core/src/**`、`scripts/mutate.sh`、`packages/eval/**`、提示词或工具定义时跑。调用 `/test-review <范围的起点> --scores "<第一步的跑分>"`，它配置成 `context: fork`，在子代理里跑，不重跑门禁。
- **code-review**：`/code-review <级别> <范围>`，级别按风险档。它在后台子代理跑，用任务通知等它，不要轮询，不要提前分诊。
- **security**：第 1 轮调 `/security-review`（它只会审整个分支，这正好是第 1 轮的范围）。N>1 且风险表要求跑时，按 `/security-review` 的三步法自己派：一个识别子代理，提示词就用第 1 轮加载的那份，只把范围换成 `git diff <范围>` 并交代 PR 做了什么、哪些边界是有意的；回来每条发现各派一个过滤子代理打分；只保留 ≥8 的。范围里只有低风险文件时写"不涉及"。

审查者的发现原文全部追加进记录文件，再分诊。

## 三、分诊与修复（机械规则，不做取舍）

每条发现只能有一个结局，写进记录文件的表里（发现 | 来源 | 级别 | 结局 | 理由或提交）：

| 结局 | 适用 | 规则 |
|---|---|---|
| 修 | code-review 的 high、important；security 保留项（≥8）；test-review 的必须改 | 本轮必修，没有例外。另外 medium 和 low 里"改动不超过二十行、不改接口、是明确的 bug 或 CLAUDE.md 有明文规矩"的也修 |
| 否决 | 发现不成立 | high、important、security 保留项：先派一个全新上下文的复核子代理，给它发现原文和相关代码，让它独立判断；它同意不成立才能否决，理由和复核结论一起记。medium 以下作者一句话理由即可 |
| 记 TODO | 成立，但超出这个 PR 的范围或要等外部条件 | 写进 README TODO 对应模块，一行，带来源（第几轮哪条）。high 和 important 不能记 TODO，除非复核子代理同意"成立但确实不属于这个 PR" |
| 丢弃 | 纯风格、命名、个人偏好，CLAUDE.md 没有对应规矩 | 不记明细，只计数 |

修复规矩：

- 一轮的所有修复合成**一个提交**，消息 `fix(review): 第 N 轮 k 条`，正文每条一行"发现 → 怎么改"。TODO 的 README 改动也进这个提交。
- 修的是护栏类问题，按 CLAUDE.md 测试纪律先补契约测试再改实现；核心逻辑的修复同步往 `scripts/mutate.sh` 加变异。这样审查抓到的每个真 bug 都变成永久的护栏，下次不用靠审查再抓一次。
- 修完重跑第一步的门禁，红了就修到绿再提交。门禁结果追加进记录文件。
- 修复提交的 HEAD 就是下一轮的范围起点。

摘要一行：`第 N 轮 <范围> · code-review high a / important b / 其余 c · security 保留 d · test-review 必须改 e · 修 f（<sha>）否决 g TODO h 丢弃 i`

## 四、停止与熔断

**"新"的定义**：一条发现如果和之前某轮已经否决或记 TODO 的是同一个问题（同一处代码、同一个主张），不算新，记一笔"重复"即可。之前"修"过的又被报出来，算新，而且是信号。

**停止条件**，本轮同时满足：code-review 没有新的 high 或 important；security 没有保留项；test-review 没有必须改。满足就进第五步。

**停止那一轮剩下的 medium 和 low**：按第三步的"修"规则最多再修一次，这个修复提交只再过一轮 `/code-review <级别> <sha>..HEAD`（不跑 security 和 test-review，除非它碰了高风险路径）。这一轮回来的 medium 和 low 一律记 TODO，不再改代码。high 或 important 则回到第二步正常循环。

**轮数不设上限**，但下面任一情况算卡住，停下来把记录文件的内容整理给人，让人拍板，不要自己绕：

- 同一条发现修了两次仍被报出来。
- 修复提交引入了新的 high 或 important，连续两轮。
- 复核子代理和审查者对一条 high 的结论相反，而作者也拿不准。

## 五、报告与推送

1. 按 `.github/pull_request_template.md` 写 PR 描述：做了什么、风险等级和高风险文件、证据表、审查记录表（每轮一行，范围写提交号）、停止依据、没修的 high（正常应为零）、没做的。内容全部来自记录文件，不凭记忆。
2. 在聊天里给人一份同样结构的收尾，加一句"审查共 N 轮，修复 k 条，否决 g 条（复核同意），TODO h 条"。高风险 PR 列出建议人亲自看的文件，不超过五个。
3. 问一次：推分支并开 PR，CI 绿了之后合并，可以吗。这是整个流程里唯一要人回答的问题。人说可以就 `git push -u origin <分支>`、`gh pr create --body-file`、等 CI、`gh pr merge --squash --delete-branch`，然后更新记忆里的项目进度。
4. 推送之后任何新提交（包括改 PR 描述以外的文档）都回到第二步，范围是 `<已审到的 HEAD>..HEAD`，合并前补完。

## 不要做的

- 不要在主上下文里替审查者下结论，不要在审查者回来前开始改代码。
- 不要为了"收敛"跳过 high 的复核，也不要为了"顺手"在停止后再改第二次。
- 不要读 `.env*`；审查发现里若提到密钥，只引用变量名。
- 不要把记录文件提交进仓库。
