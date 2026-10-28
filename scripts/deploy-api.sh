#!/usr/bin/env bash
# 发 api 到 Fly 悉尼区。只从和 origin/main 一致、CI 绿的干净 main 发：GitHub 是唯一可信来源。
# 会话锁和限流是进程内的，只能跑 1 台机器：--ha=false 让首次部署不开第二台，部署前再查一遍机器数，多了就拒。
# 构建上下文是仓库根目录（Dockerfile 要拷 packages/），脚本自己 cd 过去。部署前 release_command 会跑迁移。不透传参数，免得覆盖这些约束。
set -euo pipefail
cd "$(dirname "$0")/.."
if [ $# -gt 0 ]; then echo "deploy:api 不接受参数（$*），要改部署方式改脚本" >&2; exit 2; fi
source scripts/require-clean-main.sh
# 数所有没销毁的机器，只排除 release_command 和 fly console 的临时机器：手工 clone 出来没带进程组标签的也算，它一样会接流量
live=$(flyctl machines list -a fluffdesk-api --json | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).filter(m => m.state !== "destroyed" && !["fly_app_release_command","fly_app_console"].includes(m.config?.metadata?.fly_process_group)).map(m => m.id + "(" + (m.config?.metadata?.fly_process_group ?? "无进程组") + ")").join(" ")')
machines=$(echo "$live" | wc -w)
if [ "$machines" -gt 1 ]; then echo "fluffdesk-api 有 $machines 台会接流量的机器：$live。只能留 1 台，多的用 flyctl machine destroy <id> -a fluffdesk-api 删掉" >&2; exit 2; fi
exec flyctl deploy -a fluffdesk-api -c apps/api/fly.toml --dockerfile apps/api/Dockerfile --remote-only --ha=false
