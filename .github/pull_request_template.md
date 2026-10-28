<!-- 由 /pr-review 在推分支前填好。人只看这份，不逐行读 diff。 -->

## 做了什么

一段话。改了哪些模块，哪些是行为变化。

## 风险等级

高 / 中 / 低（按 `.claude/skills/pr-review/SKILL.md` 的路径表判定），并列出命中高风险的文件。
高风险 PR 要在这里写一句回滚办法（revert 哪个提交、迁移怎么退、环境变量要不要改回）。

## 证据

实际跑过的命令和结果，不写"做完了"。

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | |
| `npm test` | n/n |
| `npm run test:mutate` | n/n |
| `npm run eval -- quote --replay` | n/n |
| `npm run design:check` | |
| 浏览器走查（页面改动必填） | 走了哪些流程（桌面 + 手机宽度，中 + 英）；控制台 error/warn 数；网络 4xx/5xx 数；GIF 和截图的路径 |
| 接口走查（api 改动必填） | 每条改动路由的正常和错误路径，状态码 |
| 最终状态核对 | 走完后用接口查到的数据（预约状态、替代时段、修正记录） |
| `inspect.mjs --app`（页面改动必填） | FAIL n · WARN n |
| 迁移 | 在 Neon dev 分支跑过的输出 |
| eval 分数前后（改了提示词、工具定义或模型时必填） | 改前 n/24 · 改后 n/24，`--runs 3` 的 pass^3；重录的录制数 |

改了抽取或合并逻辑：Fenny & Jacks 重跑结果。

## 审查记录

每一轮一行。范围写提交号，结论写数字。

| 轮 | 范围 | test-review | code-review（级别） | security | 处理 | 修复提交 |
|---|---|---|---|---|---|---|
| 1 | `origin/main...<sha>` | 必须改 0 / 建议 n | high 0 · important n · 其余 n | 保留 0 | 修 n · 否决 n · TODO n · 丢弃 n | `<sha>` |

停止依据：第 N 轮 code-review 没有新的 high 或 important，security 没有 ≥8 的保留项。
没修的 high 或 important（如有）：每条一行，写否决理由和独立复核的结论。

## 待人审的同类发现

本次追加进 `docs/reviews/recurring-findings.md` 的条目标题，没有就写无。

## 没做的

留给后续 PR 的，已写进 README TODO 的条目。
