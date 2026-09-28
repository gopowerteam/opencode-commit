import type { GitContext } from './context.js'

/**
 * 构建提交信息生成的提示词（供 ctx.generate.text 单次调用）
 *
 * 将格式指南、git 上下文与用户额外要求组装为一条完整提示词，
 * 要求模型只输出提交信息本身，不产生任何多余内容。
 *
 * @param args.guide - 提交格式指南（COMMITS.md 或内置指南）
 * @param args.context - 本地收集的 git 上下文
 * @param args.extra - 用户在 /commit 后附加的额外要求（可空）
 * @returns 生成提示词
 */
export const buildGeneratePrompt = (args: {
  guide: string
  context: GitContext
  extra?: string
}): string => {
  const { guide, context, extra } = args

  const statusSection = context.status.trim() || '（无待提交变更）'
  const diffSection = context.diff.trim() || '（无暂存变更）'
  const extraSection = extra ? `\n\n用户额外要求（必须结合）：${extra}` : ''

  return `根据以下变更上下文和格式要求，生成一条中文约定式提交信息。

<格式要求>
${guide}
</格式要求>

<变更上下文>
## 工作区状态
${statusSection}

## 变更差异
${diffSection}

## 最近提交（供参考风格）
${context.log.trim() || '（无历史提交）'}
</变更上下文>${extraSection}

要求：
- 严格按格式要求生成，绝大多数情况只需一行 subject
- 只输出提交信息本身，不要任何解释、引号或代码块标记`
}

/**
 * 构建确认阶段的会话提示词
 *
 * 本地生成并验证通过后，将提交信息发入会话，
 * 指示模型仅执行 question 确认 → confirm 提交 → push 询问流程。
 *
 * @param args.message - 已生成并验证通过的提交信息
 * @returns 会话提示词
 */
export const buildConfirmPrompt = (args: { message: string }): string => {
  const { message } = args

  return `已为当前变更生成以下提交信息：

${message}

请立即执行以下流程，不要重新生成信息：
1. 用 question 工具让用户确认：question 内容为 "确认提交以下信息？\\n\\n${message}"，设置 custom: true，选项：确认提交、重新生成、取消
2. 用户确认后调用 commit-message-confirm 工具提交
3. 提交成功后调用 git remote 检查是否存在远程仓库：如果输出非空，用 question 工具询问用户"提交成功，是否需要执行 git push？"（设置 custom: true，选项：执行 push、不需要）；用户选择"执行 push"时调用 git-push 工具
4. 用户选择"重新生成"时：根据工作区实际变更重新撰写提交信息，调用 commit-message-validate 验证，通过后再次用 question 确认
5. 用户选择"取消"时：直接结束，不做任何操作`
}
