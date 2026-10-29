#!/usr/bin/env bash
# 变异测试：故意改坏核心逻辑，看测试会不会红。全绿不代表有护栏，这个脚本才代表。
# 用法：npm run test:mutate   每条变异 = 文件 @@ sed 表达式 @@ 说明（@@ 分隔，表达式里可以有 |）。改坏后跑测试，再用 git 恢复。
set -u
cd "$(dirname "$0")/.."

MUTATIONS=(
  'packages/core/src/tools/quote.ts@@s/const rule = exact ?? generic;/const rule = generic ?? exact;/@@quote 忽略毛质专属价目'
  'packages/core/src/booking/ports.ts@@s/status: "pending",/status: "confirmed" as never,/@@agent 直接把预约建成 confirmed'
  'packages/core/src/agent/loop.ts@@s/if (i === maxIterations - 1) {/if (false) {/@@循环到上限不转人工'
  'packages/core/src/shop/importer/extract.ts@@s/const backed = !haystack ||/const backed = true ||/@@价格不核对 evidence'
  'packages/core/src/shop/importer/extract.ts@@s/return re.test(haystack);/return true;/@@营业时间不核对原文'
  'packages/core/src/shop/importer/index.ts@@s/\&\& !locked.has(key));/\&\& true);/@@合并不锁定人工给的字段'
  'packages/core/src/shop/importer/index.ts@@s/if (idx === -1) out.push(s);/if (true) out.push(s);/@@同名服务合并不去重'
  'packages/core/src/tools/registry.ts@@s/=== "write") throw new Error/=== "never") throw new Error/@@注册表放开 write 工具'
  'packages/core/src/tools/quote.ts@@s/Disclaimer to include: "${disclaimer}"/Disclaimer: none/@@报价工具丢掉免责声明'
  'packages/core/src/tools/hold_booking.ts@@s/const service = findService(ctx.shop, args.serviceId);/const service = ctx.shop.services[0];/@@hold_booking 不校验服务 id'
  'packages/core/src/shop/importer/website.ts@@s/INTERESTING.test(new URL(l).pathname)/INTERESTING.test(l)/@@官网链接按整个 URL 匹配关键词'
  'packages/core/src/shop/importer/safe-fetch.ts@@s/for (const ip of addresses) if (isPrivateAddress(ip))/for (const ip of addresses) if (false \&\& isPrivateAddress(ip))/@@抓取不拒绝内网地址'
  'packages/core/src/tools/hold_booking.ts@@s/>= LIMITS.pendingBookingsPerConversation/>= Infinity/@@一个会话可以无限挂预约'
  'packages/core/src/tools/hold_booking.ts@@s/b.serviceId === args.serviceId \&\& b.start === args.start/false/@@hold_booking 同时段再提交挂出第二个而不是更新'
  'packages/db/src/stores/bookings.ts@@/async updatePending/,/returning()/s/, eq(bookings.status, "pending")//@@Postgres 版 updatePending 能改已决定的预约'
  'packages/db/src/app-role.ts@@s/alter default privileges in schema public grant select, insert, update, delete on tables/alter default privileges in schema public grant select on tables/@@迁移新建的表 app 角色写不了'
  'packages/core/src/agent/loop.ts@@s/if (conv.messages.length >= LIMITS.messagesPerConversation) {/if (false) {/@@会话没有消息上限'
  'apps/api/src/routes/webhooks.ts@@s/if (!expected || !provided) return false;/if (!provided) return false;/@@webhook 没配 token 时放行'
  'packages/core/src/shop/importer/safe-fetch.ts@@s/\["::ffff:0:0", 96\], //@@抓取放过 IPv4 映射的 IPv6 地址'
  'apps/api/src/routes/groomer.ts@@s/existing.shopSlug !== c.req.param("shop")/false/@@美容师端能决定别家店的预约'
  'packages/db/src/stores/bookings.ts@@s/and(eq(bookings.id, id), eq(bookings.status, "pending"))/eq(bookings.id, id)/@@Postgres 版 decide 不看 pending，已决定的还能再改'
  'packages/db/src/stores/shops.ts@@s/and(eq(shops.slug, slug), eq(shops.approved, true))/eq(shops.slug, slug)/@@agent 能看到没确认的草稿店铺'
  'apps/api/src/session-lock.ts@@s/const prev = tails.get(key) ?? Promise.resolve();/const prev = Promise.resolve();/@@同一会话并发轮次不串行'
  'packages/core/src/booking/decision.ts@@s/if (status === "confirmed") throw new DecisionInputError/if (false) throw new DecisionInputError/@@确认时也能带替代时间'
  'packages/core/src/booking/decision.ts@@s/alternatives.length > MAX_ALTERNATIVES/alternatives.length > 99/@@替代时段没有上限'
  'packages/core/src/booking/ports.ts@@s/decision.status === "declined" \&\& decision.alternatives?.length/decision.alternatives?.length/@@存储层 confirmed 也存替代时段'
  'apps/api/src/routes/groomer.ts@@s/conv.shopSlug !== c.req.param("shop")/false/g@@美容师端能看别家店的会话和图片'
  'apps/api/src/routes/groomer.ts@@s/images: \[...conv.images.keys()\]/images: [...conv.images.entries()]/@@会话接口把 base64 图片吐出去'
  'apps/api/src/routes/groomer.ts@@s/body.slug !== c.req.param("shop")/false/@@PUT shop 不校验 slug 和路径一致'
  'packages/db/src/stores/shops.ts@@s/and(eq(shops.slug, cfg.slug), eq(shops.approved, true))/eq(shops.slug, cfg.slug)/@@美容师端 save 能改草稿店'
  'packages/core/src/agent/transcript.ts@@s/if (c.type !== "text") continue;/if (false) continue;/@@轨迹把非文字块也当文字处理'
  'packages/core/src/booking/ports.ts@@s/if (!taken.some((t) => t.start < end \&\& start < t.end)) out.push/if (true) out.push/@@日历不减掉已确认的预约'
  'packages/core/src/booking/ports.ts@@s/(b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt)/(a.decidedAt ?? a.createdAt).localeCompare(b.decidedAt ?? b.createdAt)/@@历史列表变成最旧的在前'
  'packages/core/src/booking/decision.ts@@s/new Set(alternatives).size !== alternatives.length/false/@@替代时段允许重复'
  'packages/core/src/booking/ports.ts@@s/b.status === "confirmed" \&\& b.start.slice(0, 10) === date/b.status === "confirmed"/@@按日期查已确认预约时不看日期'
  'packages/db/src/stores/bookings.ts@@s/eq(bookings.status, "confirmed"), like(bookings.start, `${date}T%`)/eq(bookings.status, "confirmed")/@@Postgres 版按日期查已确认预约时不看日期'
  'packages/core/src/shop/schema.ts@@s/for (const id of duplicates(serviceIds))/for (const id of [])/@@店铺资料允许重复的服务 id'
  'packages/core/src/shop/schema.ts@@s/if (!tiers.has(p.size))/if (false)/@@价目可以指向不存在的体型档'
  'apps/api/src/routes/groomer.ts@@s/if (!limits.groomerAuth.take(ip) || /if (false || /@@猜令牌不按 IP 限流'
  'apps/api/src/routes/groomer.ts@@s/Object.hasOwn(STATUS_VIEWS, view)/view in STATUS_VIEWS/@@status 查询能命中原型链上的键'
  'packages/core/src/shop/schema.ts@@s/for (const id of duplicates(tierIds))/for (const id of [])/@@店铺资料允许重复的体型档 id'
  'apps/api/src/routes/groomer.ts@@s/if (!limits.groomerIp.take(ip))/if (!limits.perIp.take(ip))/@@美容师端和聊天共用每 IP 预算'
  'apps/api/src/routes/groomer.ts@@s/ || !limits.groomerAuthAll.take("all")//@@猜令牌换 IP 就没有全站上限'
  'packages/db/src/stores/shops.ts@@s/const cfg = validateShopConfig(config);/const cfg = parseShopConfig(config);/g@@Postgres 写边界不查引用完整性'
  'packages/core/src/booking/ports.ts@@s/ || b.createdAt.localeCompare(a.createdAt)//@@历史列表平手时次序随机'
  'packages/db/src/stores/bookings.ts@@s/, desc(bookings.createdAt))/)/@@Postgres 版历史列表平手时次序随机'
  'apps/api/src/channels/meta.ts@@s/return expected.length === provided.length \&\& timingSafeEqual(expected, provided);/return true;/@@Meta webhook 验签放行'
  'apps/api/src/routes/webhooks.ts@@s/if (!whatsappReady) return c.json/if (false) return c.json/@@WhatsApp 没配 secret 或 token 也收消息'
  'apps/api/src/channels/whatsapp.ts@@s/if (seen.get(ev.messageId)) return;/if (false) return;/@@WhatsApp 重发的消息处理两次'
  'packages/core/src/shop/repo.ts@@s/channelAccountId(s, channel) === accountId/true/@@按渠道找店不比对账号 id'
  'apps/api/src/channels/whatsapp.ts@@s/if (!rt.limits.perSession.take(`whatsapp:${ev.from}`)) return;/if (false) return;/@@WhatsApp 每号码没有限流'
  'apps/api/src/channels/meta.ts@@s/if (!IMAGE_MIME_ALLOWLIST.has(mimeType)) return { error: "type" };/if (false) return { error: "type" };/@@WhatsApp 图片不看类型'
  'apps/api/src/channels/meta.ts@@s/if (typeof meta.file_size === "number" \&\& meta.file_size > MEDIA_MAX_BYTES)/if (false)/@@WhatsApp 图片元数据超大也去下载'
  'packages/core/src/shop/importer/safe-fetch.ts@@s/if (truncated) throw new Error/if (false) throw new Error/@@二进制抓取超上限不报错只截断'
  'packages/core/src/shop/importer/safe-fetch.ts@@s/const extra = u.origin === origin ? opts.headers ?? {} : {};/const extra = opts.headers ?? {};/@@bearer 跟着重定向换主机'
  'apps/api/src/channels/whatsapp.ts@@s/!PHONE.test(m.from)/false/@@WhatsApp 发件号码不校验格式'
  'apps/api/src/routes/groomer.ts@@s/if (e instanceof ChannelBindingConflictError) return c.json/if (false) return c.json/@@渠道账号冲突不翻成 409'
  'packages/core/src/shop/repo.ts@@s/if (conflicts.length > 0) throw new ChannelBindingConflictError/if (false) throw new ChannelBindingConflictError/@@内存版渠道账号能绑到第二家店'
  'packages/db/src/stores/shops.ts@@s/if (channel) throw new ChannelBindingConflictError(channel);//@@Postgres 版渠道账号冲突不翻成领域错误'
  'packages/core/src/shop/repo.ts@@s/other.slug !== config.slug \&\& //@@店自己已有的绑定也算冲突'
  'apps/api/src/channels/meta.ts@@s/if (before >= 0xd800 \&\& before <= 0xdbff \&\& at > 1) at -= 1;/if (false) at -= 1;/@@chunkText 切断代理对'
  'apps/api/src/channels/whatsapp.ts@@s/await reply(CANNED.failed).catch/await Promise.resolve().catch/@@回复发不出去时不告诉客人'
  'apps/api/src/routes/webhooks.ts@@s/if (!rt.limits.webhookIp.take(clientIp(c)))/if (false)/@@webhook 没有每 IP 上限'
  'apps/api/src/channels/whatsapp.ts@@s/seen.delete(ev.messageId);//@@处理失败的消息 id 留在去重表里，重放进不来'
  'apps/api/src/runtime.ts@@s/await background.drain();//@@关停不等后台轮次'
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
