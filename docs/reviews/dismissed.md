# 误报与否决清单

`/pr-review` 分诊时复现不出来、或经独立复核判定不成立的审查发现，按 PR 追加在这里。用途有两个：
下一轮派 security 识别子代理时把这份清单放进提示词，`/test-review` 自己读它，措辞都是"这些已经分诊过，
引用的代码没变就不再报，变了照常报"；代码变没变看"引用的代码"那几行还在不在。
code-review 没法带提示词，分诊时对照这里，同一条算"重复"不算新发现。

和 `recurring-findings.md` 的分工：那边是"反复出现、可能要写进规矩"的真问题，给人审；这边是"查过了，不是问题"的记录，给审查者看。

格式：一条一节。

```
## <一句话概括>
- PR / 轮次：
- 引用的代码：<文件路径 + 审查者指的那几行原样贴出来；这几行还在就算代码没变。不用提交 sha：squash 合并后分支提交会悬空>
- 审查者原文：<文件:行 + 主张>
- 复现尝试：<写了什么测试 / 在浏览器里怎么点的 / 读了哪段代码>，结果
- 为什么不成立：
- 复核：<high/important 必填：复核子代理的结论>
```

---

## PUT /shop 和 PgShopRepo.save 各调一次 validateShopConfig，第二次失败会 500
- PR / 轮次：#9 第 3 轮
- 引用的代码：`apps/api/src/routes/groomer.ts` 里 `config = validateShopConfig(body);` 之后的 `await c.get("rt").shops.save(config)`；`packages/db/src/stores/shops.ts` 的 `save` 开头的 `validateShopConfig(config)`
- 审查者原文：`apps/api/src/routes/groomer.ts:160` 与 `packages/db/src/stores/shops.ts:26` 对同一对象校验两次，若第二次失败会以 500 而非 400 返回
- 复现尝试：读两处代码，都调同一个 `validateShopConfig`，它是输入的纯函数且 schema parse 幂等，路由那次通过后仓库那次拿的是同一对象，不可能失败
- 为什么不成立：路由那次是为了给 400 文案；仓库那次是 `ShopEditor` 端口（`packages/core/src/shop/repo.ts`，美容师端唯一的写口）的防御性校验，`save` 现在只有这个路由一个调用方；seed 走 `PgShopRepo.upsert`，有自己的那次；导入器只写 JSON 文件，不进库。不是给别的调用方兜底。成本可忽略。若将来两处换成不同的校验器，这条要重审
- 复核：low，作者一句话否决

## 迁移 0003 建唯一索引前不查重复数据，有重复会让 release_command 失败
- PR / 轮次：feat/whatsapp-channel 第 3 轮
- 引用的代码：`packages/db/migrations/0003_shops_channel_unique.sql` 的两条 `CREATE UNIQUE INDEX "shops_channel_whatsapp" ... WHERE ... is not null` / `"shops_channel_instagram" ...`
- 审查者原文：`packages/db/migrations/0003_shops_channel_unique.sql:1` 建索引没有数据预检，生产已有重复绑定（含过期草稿）会让 Fly 的 release_command 抛 23505，部署中止且仓库里没有补救脚本
- 复现尝试：读 `packages/core/src/shop/schema.ts` 的历史：`channels` 字段是这个 PR 新加的，合并前生产的 shops.config 里不可能有 `channels` 键；索引是部分索引（`is not null`），对没有该键的行不参与唯一性。人已在 Neon dev 分支跑过 `npm run db:migrate`，通过
- 为什么不成立：前提（存在重复绑定的旧数据）在这个 PR 合并时不可能成立。以后若出现"先有数据后加唯一索引"的迁移，这条顾虑成立，到时在迁移里先 SELECT 查重
- 复核：medium，作者一句话否决
