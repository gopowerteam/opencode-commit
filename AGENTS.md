# AGENTS.md

OpenCode 插件 `@gopowerteam/opencode-commit`：提供 `/commit` 命令和一组 git 工具，按约定式提交规范生成中文提交信息（含 emoji）。单包仓库，TypeScript ESM，Bun 工具链。

- 插件文档：https://opencode.ai/docs/plugins/ · SDK：https://opencode.ai/docs/sdk/

## 常用命令

- `bun install` — 用 bun 管理依赖（bun.lock 是唯一 lockfile；package.json 的 `packageManager` 字段写的 yarn 是无效残留，不要用 yarn/npm）
- `bun dev` — 通过 `OPENCODE_CONFIG_CONTENT` 直接以 `src/index.ts` 源码加载插件启动 OpenCode（scripts/dev.ts），调试无需先 build
- `bun typecheck` — `tsc --noEmit`（含 src 和 scripts）
- `bun test` — 运行单元测试（bun:test，覆盖 config 校验与工具层）
- `bun run build` — scripts/build.ts 两步：Bun.build 打包 `dist/index.js`（minified ESM，target bun），再 `bunx tsc -p tsconfig.build.json` 只生成 `.d.ts`
- `bun run release` — bumpp 发布：提交 `chore: release v%s` → push → 执行 `bun run build && npm publish`

验证 = `bun typecheck` + `bun test` + `bun run build`。

## 发布陷阱

- bumpp v11 只读 `bump.config.ts`；package.json 里的 `"bumpp"` 字段是旧残留、不生效。两处配置矛盾（`bump.config.ts` 的 `tag: false` vs package.json 的 `tag: "v%s"`），以 bump.config.ts 为准：**发布不打 git tag**
- 只有 `dist/` 会发布（`files: ["dist"]` + .npmignore 排除 src、scripts、schema 等），发布前必须 build

## 架构

- `src/index.ts` — 插件入口，V2 形态 `export default Plugin.define({ id: 'opencode-commit', setup })`。setup 中加载配置后经 `ctx.command.transform` 注册 `/commit`、经 `ctx.tool.transform` 注册 9 个工具
- `src/command.ts` — `/commit` 命令：`COMMIT_TEMPLATE` 是完整工作流提示词（收集 diff/status/log → generate 获取指南 → 生成信息 → validate → question 确认/重新生成/取消 → confirm 提交 → 检查 remote 询问 push），`execute` 内经 `ctx.session.prompt` 提交。**改 /commit 流程 = 改这段 template**
- `src/tools.ts` — 9 个工具工厂（V2 工具定义：JSON Schema 参数、返回 `{ content }`、`context.progress({ title })` 设展示标题）：`commit-message-generate`、`commit-message-validate`、`commit-message-confirm`、`git-amend`、`git-diff`（有未暂存变更时自动 `git add -A`）、`git-log`、`git-push`、`git-status`、`git-undo`。所有 commit/amend 走 `commitAndReport`，提交前强制 validate；git 命令用 `import { $ } from 'bun'` 直接执行
- `src/config.ts` — 读取**用户项目**根目录的 `opencode-commit.json`（types / scopes / maxLength；默认 9 类型、maxLength 72），schema 见仓库根 `opencode-commit.schema.json`
- `src/guide.ts` — 内置格式指南 `COMMIT_GUIDE`（`<type>: <emoji> <subject>`，emoji 在 subject 开头，subject ≤20 字，默认不写 body）；`MAX_DIFF_LINES = 500` 截断 diff。generate 工具优先读用户项目根目录的 `COMMITS.md` 作为自定义指南
- `src/parser.ts` / `src/validator.ts` — 解析与校验 `<type>[(<scope>)]: <emoji> <subject>`，失败抛 `CommitError`（src/errors.ts，携带 suggestions 修正建议）
- `src/safe.ts` — `safe` / `safeAsync` 返回 `Result` 类型，全仓库用它代替 try/catch，新代码保持一致
- `.opencode/` 是 OpenCode 自动生成的插件安装目录（含 node_modules），不是源码，不要改

## 约定

- 代码注释、README、工具返回文案全部使用简体中文
- 本仓库自己的提交也遵守插件自身格式：`type: emoji subject`（emoji 开头），如 `feat: ✨ 添加 git push 工具及 commit 后推送询问`
- 校验类错误信息必须附带可操作的修正建议（`CommitError.suggestions`）
- 插件要点：git 命令直接 `import { $ } from 'bun'`；工具参数 schema 用 JSON Schema；工具内用 `context.progress({ title })` 与返回值 `metadata` 设置展示标题；仅支持 OpenCode V2（peerDep `@opencode/plugin >=2.0.0`）
