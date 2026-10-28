# 被 deploy-*.sh 在仓库根目录 source：当前必须是干净的 main（含未跟踪文件），和 origin/main 同一个提交，且该提交的 CI 是绿的
branch=$(git branch --show-current)
if [ -z "$branch" ]; then echo "只从 main 发版，当前是 detached HEAD" >&2; exit 2; fi
if [ "$branch" != "main" ]; then echo "只从 main 发版，当前在 $branch" >&2; exit 2; fi
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then echo "工作区有未提交或未跟踪的文件，先提交、stash 或删掉，不然会一起发出去" >&2; exit 2; fi
git fetch -q origin main
sha=$(git rev-parse HEAD)
if [ "$sha" != "$(git rev-parse origin/main)" ]; then echo "本地 main 和 origin/main 不是同一个提交，先 pull 或 push" >&2; exit 2; fi
# gh 自己的错（没登录、没网）照常打出来并中止，别和"CI 没跑完"混在一起
conclusion=$(gh run list --branch main --commit "$sha" --workflow ci.yml --limit 1 --json conclusion -q '.[0].conclusion')
if [ "$conclusion" != "success" ]; then echo "这个提交在 GitHub 上的 CI 不是 success（现在是 '${conclusion:-没找到}'），等它绿了再发" >&2; exit 2; fi
