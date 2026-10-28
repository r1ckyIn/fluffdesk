#!/usr/bin/env bash
# 发 api 到 Fly 悉尼区。只从和 origin/main 一致的干净 main 发：GitHub 是唯一可信来源，没过三个审查的代码不上线。
# --ha=false：会话锁和限流是进程内的，只能跑 1 台机器；Fly 默认会开 2 台。
# 构建上下文是仓库根目录（Dockerfile 要拷 packages/），脚本自己 cd 过去。部署前 release_command 会跑迁移。
set -euo pipefail
cd "$(dirname "$0")/.."
source "$(dirname "$0")/require-clean-main.sh"
exec flyctl deploy -a fluffdesk-api -c apps/api/fly.toml --dockerfile apps/api/Dockerfile --remote-only --ha=false "$@"
