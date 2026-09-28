# opencode-commit 迁移 OpenCode V2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将插件从 V1 API（`@opencode-ai/plugin` 函数式入口）迁移到 V2 API（`@opencode/plugin` 的 `Plugin.define`），仅支持 OpenCode V2，功能与中文文案不变。

**Architecture:** 入口改为 `Plugin.define({ id, setup })`，`setup` 中经 `ctx.command.transform` 注册 `/commit`、经 `ctx.tool.transform` 注册 9 个工具；命令模板在 `execute` 中经 `ctx.session.prompt` 提交；工具参数用纯 JSON Schema、返回 `{ content }`；`$` 改为直接 `import { $ } from "bun"`。纯逻辑层（parser/validator/guide/safe/errors）零改动。

**Tech Stack:** TypeScript ESM、Bun（构建/测试运行器）、`@opencode/plugin@^2.0.18`、bun:test（新增）

**Spec:** `docs/superpowers/specs/2026-09-28-opencode-v2-migration-design.md`

## Global Constraints

- 仅支持 OpenCode V2；不做 V1/V2 双支持
- 运行时依赖零新增：禁止引入 zod；`opencode-commit.json` 校验手写
- peerDependencies：`"@opencode/plugin": ">=2.0.0"`（verbatim）；devDependencies 加 `"@opencode/plugin": "^2.0.18"`，删 `@opencode-ai/plugin`、`@opencode-ai/sdk`
- 9 个工具名保持平铺不加 namespace：`commit-message-generate`、`commit-message-validate`、`commit-message-confirm`、`git-amend`、`git-diff`、`git-log`、`git-push`、`git-status`、`git-undo`（`/commit` 模板按这些名字引用）
- 全部用户可见文案与代码注释使用简体中文；提交信息格式 `type: emoji subject`（emoji 开头）
- `src/parser.ts`、`src/validator.ts`、`src/guide.ts`、`src/safe.ts`、`src/errors.ts` 零改动
- 每个任务结束时 `bun typecheck` 必须通过

## Review Focus

1. `opencode-commit.json` 字段类型错误（如 `types: "feat"` 而非数组）→ 整体回退默认配置、不抛错（Task 1 测试）
2. `opencode-commit.json` 非法 JSON 或文件不存在 → 默认配置（Task 1 测试）
3. 未验证过的提交信息传给 confirm（超长/类型错）→ 拒绝提交并返回建议文案，不执行 git（Task 2 测试）
4. `/commit` 带附加文本（如"只提交 src 下的变更"）→ 附加文本拼到模板后，流程完整（Task 4 人工清单）
5. 空参数工具被调用（git-status 等）→ 正常执行不报错（Task 4 人工清单）

---

### Task 1: `src/config.ts` 去 zod 化（手写校验 + 特征测试）

**Files:**
- Modify: `src/config.ts`
- Create: `src/config.test.ts`

**Interfaces:**
- Consumes: 现有 `DEFAULT_TYPES`、`DEFAULT_MAX_LENGTH`、`safeAsync`（`src/safe.ts`）
- Produces（签名不变，后续任务依赖）: `loadConfig(directory: string): Promise<CommitConfig>`；`type CommitConfig = { types: string[]; scopes?: Record<string, string[]>; maxLength: number }`；`getAllScopes(config: CommitConfig): string[] | undefined`；`DEFAULT_TYPES`、`DEFAULT_MAX_LENGTH` 导出保持

- [ ] **Step 1: 写特征测试固定现有行为**（`src/config.test.ts`，`import { describe, test, expect } from 'bun:test'`）：

```ts
// 用临时目录 + 写文件构造用例，逐个断言：
// 1. 文件不存在 → { types: [...DEFAULT_TYPES], maxLength: 72 }，无 scopes
// 2. 完整合法配置 { types:['feat'], scopes:{a:['x']}, maxLength:50 } → 三字段全部生效
// 3. 空对象 {} → 默认值
// 4. 非法 JSON "not json" → 默认值
// 5. types 类型错误 { types: 'feat' } → 整体默认值
// 6. maxLength 非数字 { maxLength: '72' } → 整体默认值
// 7. scopes 值非 string[] { scopes: { a: 'x' } } → 整体默认值
// 8. 含未知字段 { types:['feat'], unknown: 1 } → types 生效（未知字段忽略）
// loadConfig 入参用临时目录路径（os.tmpdir() + 随机子目录，测试内创建/清理）
```

- [ ] **Step 2: 运行测试确认通过（固定现状）**

Run: `bun test src/config.test.ts`
Expected: 全部 PASS（当前 zod 实现满足这些行为）

- [ ] **Step 3: 重写 `src/config.ts`**：删除 `import { tool } from '@opencode-ai/plugin'` 与 `rawConfigSchema`；新增模块内函数 `parseRawConfig(value: unknown): { types?: string[]; scopes?: Record<string, string[]>; maxLength?: number } | null`——value 非普通对象返回 null；`types` 为 undefined 或 `Array.isArray` 且元素全是 string；`scopes` 为 undefined 或（非数组对象且每个值是 string[]）；`maxLength` 为 undefined 或（`typeof === 'number'` 且 `Number.isFinite`）；任一已存在字段不合法 → 返回 null（整体回退，与 V1 zod 行为一致）；未知字段忽略。`loadConfig` 改用 `parseRawConfig(JSON.parse(raw))`，null → 默认值，其余合并逻辑不变

- [ ] **Step 4: 运行测试确认仍通过**

Run: `bun test src/config.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "test: ✅ opencode-commit.json 校验改为手写实现并用 bun:test 固定行为"
```

---

### Task 2: 新增 `@opencode/plugin` 依赖 + `src/tools.ts` V2 化

**Files:**
- Modify: `package.json`（devDependencies 加 `"@opencode/plugin": "^2.0.18"`；此任务不动其余字段）
- Modify: `src/tools.ts`

**Interfaces:**
- Consumes: Task 1 的 `CommitConfig`/`loadConfig`（tools.ts 已引用，不变）；`@opencode/plugin` 的 V2 类型
- Produces（Task 3 依赖，签名相对 V1 的变化就这三点：去掉 `$` 参数、返回 V2 工具定义、工具内直接用导入的 `$`）:
  - `import type { Info } from '@opencode/plugin/promise/tool'`，模块内 `type V2Tool = Info`
  - `createGenerateTool(config: CommitConfig): V2Tool`
  - `createValidateTool(config: CommitConfig): V2Tool`
  - `createConfirmTool(config: CommitConfig): V2Tool`
  - `createAmendTool(config: CommitConfig): V2Tool`
  - `createDiffTool(): V2Tool`
  - `createLogTool(): V2Tool`
  - `createPushTool(): V2Tool`
  - `createStatusTool(): V2Tool`
  - `createUndoTool(): V2Tool`
  - 私有 `commitAndReport(message: string, config: CommitConfig, flag: '' | '--amend'): Promise<{ content: string; title?: string; info?: { branch: string; hash: string } }>`（不再接收 `$`；成功分支填 title 与 info）

- [ ] **Step 1: `package.json` devDependencies 加 `"@opencode/plugin": "^2.0.18"`，然后 `bun install`**

Run: `bun install`
Expected: bun.lock 更新，安装成功

- [ ] **Step 2: 重写 `src/tools.ts`**，规则（git 命令与全部中文文案从现有实现逐行保留）：
  - 顶部 `import { $ } from 'bun'`；删除 `type BunShell`、`import { tool } from '@opencode-ai/plugin'`、各工厂的 `$` 参数
  - input JSON Schema 固定形态——message 类：`{ type: 'object', properties: { message: { type: 'string', description: <沿用原 describe 文案> } }, required: ['message'], additionalProperties: false }`；count 类：`properties: { count: { type: 'number', description: <沿用> } }`（无 required）；staged：`properties: { staged: { type: 'boolean', description: '显示暂存的变更（默认: true）' } }`；空参数：`{ type: 'object', properties: {}, additionalProperties: false }`
  - execute 内读取参数用窄化：`(input as { message: string }).message` 等；`staged` 保持 `!== false` 语义
  - 返回值：字符串结果一律 `{ content: <原文案> }`；V1 `context.metadata({ title: X })` → `await context.progress({ title: X })`（generate/diff/push/confirm/amend 照搬原 title 文案）
  - `commitAndReport`：验证失败/各类失败分支返回 `{ content: <原错误文案> }`；成功分支返回 `{ content: '✅ ' + action + '！\n- 分支: ...\n- Hash: ...\n\n' + git输出, title: '✅ ' + message }`
  - `createConfirmTool`/`createAmendTool` 的 execute：开始时 `progress({ title: 原开始文案 })`；成功时返回 `{ content, metadata: { title: result.title, branch, hash } }`（从 commitAndReport 结果取；失败时 `{ content }`）。为此 commitAndReport 成功返回需含 branch/hash——定义 `commitAndReport(...): Promise<{ content: string; title?: string; info?: { branch: string; hash: string } }>`
  - description/参数描述等 prompt 可见文案逐字保留

- [ ] **Step 3: 全量校验（此时 `src/index.ts` 仍是 V1，旧依赖还在，应全绿）**

Run: `bun test src/config.test.ts && bun typecheck`
Expected: 测试 PASS；typecheck 无错误

- [ ] **Step 4: 写 confirm 拒绝路径测试（`src/tools.test.ts`）**：`createConfirmTool({ types: ['feat'], maxLength: 10 }).execute({ message: 'feat: 这条提交信息远远超过十个字符的限制' }, { progress: async () => {} })` 返回的 `content` 包含 `验证失败`，且全程未执行 git（非法信息在 shell 调用前即返回）

Run: `bun test src/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/tools.ts src/tools.test.ts
git commit -m "refactor: ♻️ 工具层迁移到 OpenCode V2 tool API（JSON Schema 参数 + content 返回）"
```

---

### Task 3: V2 入口（`src/index.ts` + `src/command.ts`）+ 移除 V1 依赖

**Files:**
- Create: `src/command.ts`
- Modify: `src/index.ts`
- Modify: `package.json`（version `0.1.0`；peerDependencies `{"@opencode/plugin": ">=2.0.0"}`；devDependencies 删 `@opencode-ai/plugin`、`@opencode-ai/sdk`）
- Modify: `bun.lock`（bun install 生成）

**Interfaces:**
- Consumes: Task 2 的 9 个 `createXxxTool` 工厂；Task 1 的 `loadConfig`
- Produces: 包默认导出 `Plugin.define({ id: 'opencode-commit', setup })`；`src/command.ts` 导出 `COMMIT_TEMPLATE: string`（V1 index.ts 中 `cfg.command['commit'].template` 的完整字符串，逐字保留）与 `registerCommitCommand(ctx: Pick<Context, 'command' | 'session'>): Promise<Registration>`（`Context` 从 `@opencode/plugin/promise/plugin` 导入类型；`Registration` 从 `@opencode/plugin/promise/registration` 导入，若该子路径无此导出则改用 `ReturnType<Context['command']['transform']>` 作为返回类型）

- [ ] **Step 1: 创建 `src/command.ts`**：`COMMIT_TEMPLATE` 常量（从现 `src/index.ts:37-54` 的 template 字符串逐字迁移）；`registerCommitCommand` 内 `ctx.command.transform` 注册 `{ name: 'commit', description: '根据变更内容生成中文提交信息，确认后提交', execute: async (invocation) => { const extra = invocation.prompt.text?.trim(); await ctx.session.prompt({ sessionID: invocation.sessionID, text: extra ? COMMIT_TEMPLATE + '\n\n' + extra : COMMIT_TEMPLATE, delivery: invocation.delivery }) } }`

- [ ] **Step 2: 重写 `src/index.ts`**：

```ts
import { Plugin } from '@opencode/plugin'
// setup(ctx):
//   const commitConfig = await loadConfig(ctx.location.directory)
//   await registerCommitCommand(ctx)
//   await ctx.tool.transform((editor) => {
//     editor.add(createGenerateTool(commitConfig))   // 9 个工厂按 index.ts 现有顺序逐一 editor.add
//     ...
//   })
export default Plugin.define({ id: 'opencode-commit', async setup(ctx) { ... } })
```

删除 V1 具名导出 `OpencodeCommitPlugin` 与 `config` 钩子

- [ ] **Step 3: `package.json` 三处修改（version / peerDependencies / devDependencies）后 `bun install`**

Run: `bun install`
Expected: `@opencode-ai/*` 从 bun.lock 消失

- [ ] **Step 4: 全量验证**

Run: `bun typecheck && bun test && bun run build`
Expected: typecheck 0 错误；测试全 PASS；build 产出 `dist/index.js` + `dist/index.d.ts`

- [ ] **Step 5: Commit**

```bash
git add src/command.ts src/index.ts package.json bun.lock
git commit -m "feat: ✨ 迁移到 OpenCode V2 插件 API，仅支持 V2（v0.1.0）"
```

---

### Task 4: dev 脚本与文档 + 最终人工验证

**Files:**
- Modify: `scripts/dev.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 3 完成后的可构建包
- Produces: 文档与脚本与 V2 现实一致；人工验证清单全部通过

- [ ] **Step 1: `scripts/dev.ts`**：删除 `import type { Config } from '@opencode-ai/sdk'`；`const config = { plugins: [pluginPath] }`（不再 `satisfies Config`）；其余 spawn 逻辑不变

- [ ] **Step 2: `README.md`**：安装节手动配置示例改为 `{ "plugins": ["@gopowerteam/opencode-commit@latest"] }`（键 `plugin`→`plugins`），注明**仅支持 OpenCode V2**；使用节补充说明 `/commit` 在当前会话执行（V1 的子代理委托 subtask 在 V2 插件命令上无对应字段）；开发节加 `bun test`

- [ ] **Step 3: `AGENTS.md`**：入口描述改为 V2 形态（`Plugin.define`/`ctx.command.transform`/`ctx.tool.transform`/`import { $ } from "bun"`）；"本仓库没有测试"改为 `bun test`；架构节补 `src/command.ts`；依赖描述更新

- [ ] **Step 4: 自动化验证**

Run: `bun typecheck && bun test && bun run build`
Expected: 全部通过

- [ ] **Step 5: 人工验证（`bun dev` 起真实 OpenCode V2）**：
  1. 插件列表出现 `opencode-commit`
  2. `/commit` 全流程：收集 diff/status/log → 生成 → 验证 → question 确认 → 提交 → remote 检查 → push 询问
  3. `/commit 只提交 src 下的变更`（附加文本场景，Review Focus #4）
  4. 9 个工具逐一调用（含空参数的 git-status/git-push/commit-message-generate，Review Focus #5）
  5. 临时项目放 `opencode-commit.json`（自定义 types/maxLength）验证生效
  6. 若 `OPENCODE_CONFIG_CONTENT` 未生效（插件未加载）：dev.ts 改为生成临时 opencode.json 并用 `--config` 指向后重试
  7. 发布后验证（需先 npm publish，经用户明确指示）：干净项目以 `"plugins": ["@gopowerteam/opencode-commit@latest"]` 安装并加载成功
- [ ] **Step 6: Commit**

```bash
git add scripts/dev.ts README.md AGENTS.md
git commit -m "docs: 📝 dev 脚本与文档适配 OpenCode V2"
```
