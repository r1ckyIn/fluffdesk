# 被 deploy-*.sh source：当前必须是干净的 main，且和 origin/main 同一个提交
branch=$(git branch --show-current)
if [ "$branch" != "main" ]; then echo "只从 main 发版，当前在 $branch" >&2; exit 2; fi
if ! git diff --quiet || ! git diff --cached --quiet; then echo "工作区有未提交的改动，先提交或 stash" >&2; exit 2; fi
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then echo "本地 main 和 origin/main 不是同一个提交，先 pull 或 push" >&2; exit 2; fi
