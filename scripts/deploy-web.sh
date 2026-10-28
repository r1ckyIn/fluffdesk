#!/usr/bin/env bash
# 发 web 到 Vercel 生产（https://fluffdesk-web.vercel.app）。只从和 origin/main 一致、CI 绿的干净 main 发。
# Vercel CLI 钉版本：它的单仓/根目录探测在大版本间变过，发版要可复现。不透传参数。
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/require-clean-main.sh
exec npx --yes vercel@65.5.0 --cwd apps/web --prod
