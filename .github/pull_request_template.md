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
| 改动路径实际走了一遍 | 怎么走的、看到了什么（接口用 curl / 页面用 Chrome / 迁移在 Neon dev 分支） |

改了抽取或合并逻辑：Fenny & Jacks 重跑结果。改了提示词或工具定义：重录的录制数。

## 审查记录

每一轮一行。范围写提交号，结论写数字。

| 轮 | 范围 | test-review | code-review（级别） | security | 处理 | 修复提交 |
|---|---|---|---|---|---|---|
| 1 | `origin/main...<sha>` | 必须改 0 / 建议 n | high 0 · important n · 其余 n | 保留 0 | 修 n · 否决 n · TODO n · 丢弃 n | `<sha>` |

停止依据：第 N 轮 code-review 没有新的 high 或 important，security 没有 ≥8 的保留项。
没修的 high 或 important（如有）：每条一行，写否决理由和独立复核的结论。

## 没做的

留给后续 PR 的，已写进 README TODO 的条目。
