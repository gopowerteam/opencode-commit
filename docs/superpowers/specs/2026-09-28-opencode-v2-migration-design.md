# opencode-commit 迁移 OpenCode V2 插件 API — 设计文档

日期：2026-09-28
状态：待评审

## 背景与目标

OpenCode V2 重写了插件 API，官方明确 **V1 插件实现无法在 V2 运行**。本插件当前完全基于 V1 API（`@opencode-ai/plugin`：函数式入口 + `config` 钩子注册命令 + `tool` map 注册工具 + `ctx.$` Bun Shell）。

目标：将插件迁移到 V2 插件 API（`@opencode/plugin`），**仅支持 V2**（用户已决策，不做单包双支持），保持功能与中文交互体验不变。

## 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 兼容策略 | 仅 V2 | 用户决策；V2 已取代 V1，不并存 |
| 迁移方式 | 方案 A：就地迁移 | 官方迁移路径，无永久抽象层；方案 C（适配层）被否 |
| 命令注册 | `execute` + `ctx.session.prompt` | V2 插件 `CommandDefinition` 仅有 `name/description/execute`，无 `template` 字段（已从 `@opencode/plugin@2.0.18` 类型确认） |
| 工具 schema | 纯 JSON Schema 对象 | `Tool.ValueSchema` 原生接受 `JsonSchema`，无需 zod 依赖 |

## 依赖与包结构

- peerDependencies：删除 `@opencode-ai/plugin`，新增 `@opencode/plugin: ">=2.0.0"`
- devDependencies：新增 `@opencode/plugin: ^2.0.18`（类型来源）；删除 `@opencode-ai/plugin`、`@opencode-ai/sdk`（后者仅被 scripts/dev.ts 的 `Config` 类型引用，一并移除）
- 入口不变：`dist/index.js` 单文件 ESM；`scripts/build.ts` 无需改动
- 版本升 `0.1.0`（破坏性变更：不再支持 OpenCode V1）

## 入口 `src/index.ts`

```ts
import { Plugin } from '@opencode/plugin'

export default Plugin.define({
  id: 'opencode-commit',
  async setup(ctx) {
    const commitConfig = await loadConfig(ctx.location.directory)
    // 1. ctx.command.transform 注册 /commit（见下节）
    // 2. ctx.tool.transform 注册 9 个工具（见下节）
  },
})
```

- `id: 'opencode-commit'` 为稳定插件 ID（存储与诊断按此 ID 归属）
- V1 的 `ctx.directory` → `ctx.location.directory`（`Context` 类型已确认含 `location: Location.Info`）

## `/commit` 命令移植

V2 插件命令是程序化的。原 V1 `template` 字符串（完整中文工作流提示词）原样保留为常量 `COMMIT_TEMPLATE`，在 `execute` 中作为 prompt 提交：

```ts
ctx.command.transform((editor) => {
  editor.add({
    name: 'commit',
    description: '根据变更内容生成中文提交信息，确认后提交',
    async execute(invocation) {
      const extra = invocation.prompt.text?.trim()
      await ctx.session.prompt({
        sessionID: invocation.sessionID,
        text: extra ? `${COMMIT_TEMPLATE}\n\n${extra}` : COMMIT_TEMPLATE,
        delivery: invocation.delivery,
      })
    },
  })
})
```

**已知差异**：V1 的 `subtask: true`（命令委托子代理执行）在 V2 插件 `CommandDefinition` 上无对应字段。接受差异：命令在当前会话内执行。在 README 注明；如需子代理行为，用户可自行在 `.opencode/commands/` 定义命令文件（V2 配置层仍支持 `subagent: true`）。

## 工具移植（9 个）

通过 `ctx.tool.transform((editor) => { editor.add(...) })` 注册。工具名保持平铺（不加 `namespace`），`/commit` 提示词中引用的工具名不变。

参数从 `tool.schema`（zod 风格）改为 JSON Schema；返回值统一为 `Promise<Result>`，文案放 `content`：

| 工具 | input (JSON Schema) | V1 返回 → V2 处理 |
|---|---|---|
| commit-message-generate | `{}` | string → `{ content }`；`context.metadata({title})` → `context.progress({ title })` |
| commit-message-validate | `message: string`（required） | string → `{ content }` |
| commit-message-confirm | `message: string`（required） | `{ output, metadata }`/string → `{ content: output, metadata: { title: '✅ ...', ...result.metadata } }`；开始时 `progress({ title: '🚀 ...' })` |
| git-amend | `message: string`（required） | 同 confirm（title：📝 → ✅） |
| git-diff | `staged?: boolean` | string → `{ content }`；自动暂存时 `progress({ title: '📦 自动暂存变更...' })` |
| git-log | `count?: number` | string → `{ content }` |
| git-push | `{}` | string → `{ content }`；`progress({ title: '🚀 推送到远程仓库...' })` |
| git-status | `{}` | string → `{ content }` |
| git-undo | `count?: number` | string → `{ content }` |

类型事实（来源 `@opencode/plugin@2.0.18` / `@opencode/schema@2.0.18` .d.ts）：

- `Tool.Info = { name, description, input: ValueSchema, execute(input, context: ToolContext) => Promise<Result>, output?, options? }`
- `Tool.Result = { output?, content?: string | Content[], metadata?: Record<string, any> }`
- `ToolContext = { sessionID, agent, messageID, id, signal: AbortSignal, progress(update: Metadata) => Promise<void> }`
- 空参数工具 input 用 `{ type: 'object', properties: {}, additionalProperties: false }`

## Shell 与逻辑层

- 删除 `BunShell`（`PluginInput['$']`）参数注入；`src/tools.ts` 顶部 `import { $ } from 'bun'`，所有 git 命令调用逻辑不变
- `src/config.ts`：`rawConfigSchema` 目前用 `tool.schema`（zod）校验 `opencode-commit.json` 的 3 个字段——改为手写轻量校验函数（检查 types 为 string[]、scopes 为 Record<string,string[]>、maxLength 为 number），保持"解析失败回退默认值"语义不变；不再从任何 plugin 包导入
- `parser.ts` / `validator.ts` / `guide.ts` / `safe.ts` / `errors.ts`：零改动

## 周边更新

- `scripts/dev.ts`：注入配置改为 `{ plugins: [pluginPath] }`（键名 `plugin` → `plugins`）；删除 `@opencode-ai/sdk` 类型导入，用内联对象；`OPENCODE_CONFIG_CONTENT` 环境变量在 V2 的有效性装包后实测，若失效改为临时配置文件方案
- `README.md`：安装配置示例 `"plugin": [...]` → `"plugins": ["@gopowerteam/opencode-commit@latest"]`；注明仅支持 OpenCode V2 及 subtask 差异
- `AGENTS.md`：入口描述同步为 V2 形态

## 错误处理

沿用 `safe`/`safeAsync` Result 模式。工具失败时返回中文错误文案包在 `{ content }` 中（不抛异常，与 V1 行为一致）。`/commit` 的 execute 中 `ctx.session.prompt` 失败向上抛出由宿主处理。

## 验证计划

1. `bun typecheck` 通过
2. `bun run build` 通过（Bun.build + d.ts 生成）
3. `bun dev` 启动真实 OpenCode V2：
   - 插件出现在插件列表（id: opencode-commit）
   - `/commit` 全流程：收集上下文 → 生成 → 验证 → 确认 → 提交 → push 询问
   - 9 个工具逐一调用验证
   - `opencode-commit.json` 自定义 types/scopes/maxLength 生效
4. 干净项目测试安装配置（`plugins` 键 + `@latest`）

## 风险

- `OPENCODE_CONFIG_CONTENT` 若在 V2 已改名/移除 → dev 脚本改用临时 opencode.json（验证计划第 3 步暴露）
- `ctx.session.prompt` 的 `delivery` 透传行为与 V1 模板提交的细微差异 → 验证计划第 3 步人工确认
