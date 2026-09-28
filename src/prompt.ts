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
 * 本地生成并验证通过后，将提交信息发入会话。
 * 指令按单一职责收紧：模型只做 question 询问与依答复的
 * 单步动作，并明确告知提交已获用户授权，防止模型在全局
 * git 规则与流程间反复推理造成多次往返。
 *
 * @param args.message - 已生成并验证通过的提交信息
 * @param args.push - 是否在提交成功后自动推送（--push 标志）
 * @returns 会话提示词
 */
export const buildConfirmPrompt = (args: { message: string; push?: boolean }): string => {
  const { message, push } = args

  const confirmStep = push
    ? '2. 答复为"确认提交"→ 立即调用 commit-message-confirm 工具（message 参数为上面的信息），提交成功后调用 git-push 工具推送，随后原样展示提交与推送结果并结束'
    : '2. 答复为"确认提交"→ 立即调用 commit-message-confirm 工具（message 参数为上面的信息），随后原样展示提交结果并结束'

  const whitelist = push
    ? 'question、commit-message-validate、commit-message-confirm、git-push'
    : 'question、commit-message-validate、commit-message-confirm'

  return `已为当前变更生成并通过格式校验的提交信息：

${message}

用户已通过 /commit 明确要求完成提交，请严格按以下步骤执行，不要重新生成信息，不要重新评估是否允许提交：
1. 调用 question 工具让用户确认：问题内容为"确认提交以下信息？\\n\\n${message}"，设置 custom: true，选项：确认提交、重新生成、取消
${confirmStep}
3. 答复为"重新生成"→ 根据工作区实际变更重新撰写提交信息，调用 commit-message-validate 验证，通过后回到第 1 步再次确认
4. 答复为"取消"→ 直接结束，不做任何操作

只执行以上步骤：除 ${whitelist} 外不要调用其他工具，不要重复询问。`
}

