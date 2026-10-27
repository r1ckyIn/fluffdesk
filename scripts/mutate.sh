#!/usr/bin/env bash
# 变异测试：故意改坏核心逻辑，看测试会不会红。全绿不代表有护栏，这个脚本才代表。
# 用法：npm run test:mutate   每条变异 = 文件 @@ sed 表达式 @@ 说明（@@ 分隔，表达式里可以有 |）。改坏后跑测试，再用 git 恢复。
set -u
cd "$(dirname "$0")/.."

MUTATIONS=(
  'packages/core/src/tools/quote.ts@@s/const rule = exact ?? generic;/const rule = generic ?? exact;/@@quote 忽略毛质专属价目'
  'packages/core/src/booking/ports.ts@@s/status: "pending",/status: "confirmed" as never,/@@agent 直接把预约建成 confirmed'
  'packages/core/src/agent/loop.ts@@s/if (i === maxIterations - 1) {/if (false) {/@@循环到上限不转人工'
  'packages/core/src/shop/importer/extract.ts@@s/const numbersInEvidence = !haystack || s.prices.every/const numbersInEvidence = true || s.prices.every/@@价格不核对 evidence'
  'packages/core/src/shop/importer/index.ts@@s/if (idx === -1) out.push(s);/if (true) out.push(s);/@@同名服务合并不去重'
  'packages/core/src/tools/registry.ts@@s/=== "write") throw new Error/=== "never") throw new Error/@@注册表放开 write 工具'
  'packages/core/src/tools/quote.ts@@s/Disclaimer to include: "${disclaimer}"/Disclaimer: none/@@报价工具丢掉免责声明'
  'packages/core/src/tools/hold_booking.ts@@s/const service = findService(ctx.shop, args.serviceId);/const service = ctx.shop.services[0];/@@hold_booking 不校验服务 id'
  'packages/core/src/shop/importer/website.ts@@s/INTERESTING.test(new URL(l).pathname)/INTERESTING.test(l)/@@官网链接按整个 URL 匹配关键词'
  'packages/core/src/shop/importer/safe-fetch.ts@@s/for (const ip of addresses) if (isPrivateAddress(ip))/for (const ip of addresses) if (false \&\& isPrivateAddress(ip))/@@抓取不拒绝内网地址'
  'packages/core/src/tools/hold_booking.ts@@s/>= LIMITS.pendingBookingsPerConversation/>= Infinity/@@一个会话可以无限挂预约'
  'packages/core/src/agent/loop.ts@@s/if (conv.messages.length >= LIMITS.messagesPerConversation) {/if (false) {/@@会话没有消息上限'
  'apps/api/src/routes/webhooks.ts@@s/if (!expected || !provided) return false;/if (!provided) return false;/@@webhook 没配 token 时放行'
)

files=()
for m in "${MUTATIONS[@]}"; do files+=("${m%%@@*}"); done
if ! git diff --quiet -- "${files[@]}"; then
  echo "被变异的文件有未提交改动，先提交或 stash 再跑" >&2
  exit 2
fi

caught=0; escaped=0; report=()
for m in "${MUTATIONS[@]}"; do
  file="${m%%@@*}"; rest="${m#*@@}"; expr="${rest%%@@*}"; label="${rest#*@@}"
  sed -i "$expr" "$file"
  if git diff --quiet -- "$file"; then
    report+=("??  $label（sed 没匹配到，变异没生效，检查脚本）"); escaped=$((escaped+1))
  elif npx vitest run --reporter=dot >/dev/null 2>&1; then
    report+=("逃掉  $label"); escaped=$((escaped+1))
  else
    report+=("抓住  $label"); caught=$((caught+1))
  fi
  git checkout -q -- "$file"
done

printf '%s\n' "${report[@]}"
echo "抓住 $caught / $((caught+escaped))"
[ "$escaped" -eq 0 ]
