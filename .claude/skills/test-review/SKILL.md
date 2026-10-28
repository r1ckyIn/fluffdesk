---
name: test-review
description: 开 PR 前按 fluffdesk 的测试策略（docs/adr/0001）审一遍改动：新护栏有没有契约测试、新核心逻辑有没有配变异、测试是不是在抄实现或 mock 被测对象、改了提示词有没有重录回放、工具结果有没有引入随机值。CI 只能守结果，这个 skill 守写法。改了 packages/core、packages/eval、提示词或测试之后用。
argument-hint: "[对比的基准分支，默认 origin/main]"
allowed-tools: Bash(git diff *), Bash(git status *), Bash(git log *), Bash(npm test), Bash(npm run test:mutate), Bash(npm run eval -- quote --replay), Read, Grep, Glob
---

# 测试写法审查

基准分支：`$ARGUMENTS`（空则用 `origin/main`）。本次改动的文件：

```!
base="$ARGUMENTS"; base="${base:-origin/main}"; echo "base: $base"; git diff --stat "$base"...HEAD
```

先读 `docs/adr/0001-testing-strategy.md` 的"决定"和"不做什么"两节，再按下面十条逐一核对。每条都要给出结论和证据（文件:行），没涉及的写"不涉及"。

## 一、改动分类

把改动文件分到这几类，后面每条检查只看相关类：
- **核心逻辑**：`packages/core/src/**`（工具、循环、抽取、合并、预约）
- **规矩或护栏**：涉及 CLAUDE.md "规矩"里任何一条（pending、免责声明、价目表上限、write 工具）
- **提示词或工具定义**：`agent/prompt.ts`、`tools/*.ts` 的 `definition`、`shop/importer/extract.ts` 的 SYSTEM 和 schema
- **测试**：`packages/*/test/**`
- **eval**：`packages/eval/datasets/**`、`recordings/**`、`graders/**`
- **CI 或脚本**：`.github/workflows/**`、`scripts/mutate.sh`

## 二、十条检查

1. **新护栏有契约测试吗。** 改了规矩相关代码，对应的契约测试文件里要有用例：业务规矩在 `packages/core/test/guardrails.test.ts`，公网输入的上限和 SSRF 在 `packages/core/test/security.test.ts`，HTTP 边界（鉴权、限流、失败关闭）在 `apps/api/test/routes.test.ts`。断言的是行为（工具返回的文本、预约的状态、注册表抛错、HTTP 状态码），不是类型。反例：注册表的 write 拦截原来只在 TypeScript 类型上，变异把它改掉测试照样绿。
2. **新核心逻辑有变异吗。** 核心逻辑每加一条分支，`scripts/mutate.sh` 的 `MUTATIONS` 里要加一条能把它改坏的 sed。没有变异的护栏等于没人验。检查变异的 sed 真的匹配得到（脚本会报"sed 没匹配到"）。
3. **测试是否在抄实现常数。** 搜 `toBe(0.` `toBeCloseTo(` `toBe(0.9)` 这类对置信度、权重、阈值的精确断言。这些该改成和 `LOW_CONFIDENCE` 比大小。常数是调参，不是规则。
4. **是否 mock 了被测对象。** faux provider 只能用来喂模型回复。`vi.mock`、`vi.spyOn` 打在 `runTurn`、`computeQuote`、`verifyDraft`、`mergeDrafts` 这类被测函数上就是在测 mock。
5. **只断言"没报错"的测试。** 只有 `resolves.toBeDefined()`、`not.toThrow()`、`toBeTruthy()` 而没有内容断言的，要补内容断言或删掉。
6. **改了提示词、工具定义、schema 或 eval 输入，录制重录了吗。** 这些任何一处变了，请求指纹就变。看 `git diff --stat packages/eval/recordings` 有没有同步更新；然后跑 `npm run eval -- quote --replay`，指纹对不上会报第一处差异。对不上就是要重录（`--record`），不是改指纹算法。
7. **工具结果里有没有随机值。** 新工具或改过的工具，返回给模型的 `text` 里不能有 `Date.now()`、`Math.random()`、自增以外的 id、当前时间。有就要可注入（参考 `InMemoryBookingStore` 的 `nextId`），否则回放必坏。
8. **改了抽取或合并，真店回归跑了吗。** `shop/importer/**` 有改动，PR 描述里要有 Fenny & Jacks 重跑结果：七个服务、六档价目、营业时间周一到周六。没跑就标为必须。
9. **eval 用例质量。** 新用例的 `expect` 至少有一条最终状态断言（`priceWithin`、`pendingBookings`、`saysAny`、`replyMatches`），不能只有 `toolCalled`。多轮用例检查第二轮是不是真的需要（模型先复述再确认是对的行为，用例要顺着它写，不是逼它一轮做完）。
10. **CI 门禁有没有被削弱。** `.github/workflows/ci.yml` 或 `scripts/mutate.sh` 的改动里，删步骤、`continue-on-error`、`|| true`、减少变异条数、放宽 `[ "$escaped" -eq 0 ]`，一律标为必须改。

## 三、实际跑一遍

检查完条目后依次跑，把结果贴进报告：

```
npm test
npm run test:mutate
npm run eval -- quote --replay
```

任何一项红了，报告结论就是"不能开 PR"，不管清单过了几条。

## 四、输出格式

```
## 必须改（阻塞 PR）
- [条目号] 文件:行  问题一句话  怎么改一句话

## 建议
- ...

## 通过
- [条目号] 一句话证据

## 跑分
test 69/69 · mutate 9/9 · replay 24/24

结论：可以开 PR / 不能开 PR，原因
```

只报有证据的问题。拿不准的放"建议"，不放"必须改"。
