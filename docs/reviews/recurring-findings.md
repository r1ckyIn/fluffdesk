# 反复出现的审查发现

`/pr-review` 在分诊时，发现一条和以前某个 PR 里出现过的是同一类问题，就在这里追加一条，**不直接改 CLAUDE.md、skill 或任何配置**。
由 Lachie 逐条审，决定写进哪条规矩、加进哪个清单，还是不理。agent 只追加，不改"状态"和"决定"两栏。

判断"同一类"的依据：这个文件里已有的条目，加 `git log --grep='fix(review)'` 里修复提交正文列出的发现。

格式：一条一节，字段固定。

```
## <一句话概括问题类型>
- 状态：待审            ← agent 写"待审"，人改成"采纳 / 否决 / 观察"
- 出现：<PR 或分支>#<轮次> <日期>；<PR 或分支>#<轮次> <日期>
- 原文：<审查者的发现，各一行，带文件:行>
- 当时怎么处理：<修 / 否决 / TODO，各一行>
- 建议写到哪：<CLAUDE.md 规矩 / test-review 第几条 / pr-review 分诊规则 / mutate.sh / 不写，理由>
- 决定：                 ← 人填
```

---

## 检查或测试依赖 dist 构建产物，而不是源码或提交进仓库的文件
- 状态：待审
- 出现：PR #1 code-review（2026-10-27）；chore/taste-skill#1（2026-10-28）
- 原文：
  - PR #1：vitest 把 `@fluffdesk/core` 解析到 `packages/core/dist`，dist 只在 `tsc -b` 时更新，回放测试和 eval 可能跑的是改动前的代码，变异对回放层没有检测力
  - chore/taste-skill#1：`packages/design/scripts/tokens-to-css.mjs:10` 的 `--check` 比对 `packages/design/dist/tokens.css`，dist 被 gitignore、CI 里 `npm ci --ignore-scripts` 不构建，`existsSync` 为 false → 每个 PR 的 `design:check` 都红
- 当时怎么处理：PR #1 修（vitest alias 指向 src）；chore/taste-skill#1 修（--check 只比对提交进仓库的 apps/web/app/tokens.css，dist 存在才比）
- 建议写到哪：test-review 第 10 条旁边加一条"CI 里跑的脚本不能依赖 gitignore 的产物（dist/、.next/、node_modules 以外的生成文件）；本地绿 CI 红的第一嫌疑就是它"；或 CLAUDE.md 测试纪律一行
- 决定：
