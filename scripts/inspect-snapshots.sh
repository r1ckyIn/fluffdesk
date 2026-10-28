#!/usr/bin/env bash
# 用 tasteskill 的 inspector 检查 .taste-skill/snapshots/ 下的页面快照（app 规则）。
# 快照是登录后从浏览器里抓的静态 HTML，样式表指向本机正在跑的 web（见 docs/design-system.md）。
# 用法：bash scripts/inspect-snapshots.sh [名字...]   不带参数就检查全部快照
set -euo pipefail
cd "$(dirname "$0")/.."
INSPECT=.claude/skills/design-taste-frontend/scripts/inspect.mjs
names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  for f in .taste-skill/snapshots/*.html; do names+=("$(basename "$f" .html)"); done
fi
for n in "${names[@]}"; do
  echo "=============== $n ==============="
  node "$INSPECT" --app ".taste-skill/snapshots/$n.html" --out ".taste-skill/inspect/$n" || true
done
