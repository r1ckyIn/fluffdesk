#!/usr/bin/env bash
# 发 api 到 Fly 悉尼区。只从和 origin/main 一致、CI 绿的干净 main 发：GitHub 是唯一可信来源。
# 会话锁和限流是进程内的，只能跑 1 台机器：--ha=false 让首次部署不开第二台，部署前再查一遍机器数，多了就拒。
# 构建上下文是仓库根目录（Dockerfile 要拷 packages/），脚本自己 cd 过去。部署前 release_command 会跑迁移。不透传参数，免得覆盖这些约束。
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/require-clean-main.sh
machines=$(flyctl machines list -a fluffdesk-api --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))')
if [ "$machines" -gt 1 ]; then echo "fluffdesk-api 现在有 $machines 台机器，先 flyctl scale count 1 -a fluffdesk-api 缩回 1 台" >&2; exit 2; fi
exec flyctl deploy -a fluffdesk-api -c apps/api/fly.toml --dockerfile apps/api/Dockerfile --remote-only --ha=false
