# 设计系统

- 正本：`packages/design/project/`（tokens.json、README.md 品牌手册、components/ 预览和说明、assets/Brand）
- 可浏览版（Design System artifact，私有，需要分享才能给别人看）：https://claude.ai/artifact/DkQ8ckt8SCvfgaQiG784hT
- 重新发布：改完 `packages/design/project/` 后 `npm run design:build`，再让 Claude Code 把变更的文件发布到上面的 artifact（root = packages/design）
- 来源：颜色和字体取自 Eirlys AI 设计规范（2026-10-21 版，Mac 上 `/Users/Shared/clean-workspace/tmp/eirlys-web-DESIGN-SPEC.md`）；布局和规矩按 tasteskill v2 app-screen，风格 framed-sheet（seed 1004027668）
- 和 Eirlys 规范的三处有意偏离：纸面不带淡紫阴影（层次靠明度差）、不用 Geist Mono 大写眉标（app 只有一个无衬线 + Fraunces 做字标和标题）、数字用 Figtree 的等宽数字
