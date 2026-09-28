import type { Context } from '@opencode/plugin/promise/plugin'
import type { Registration } from '@opencode/plugin/promise/registration'

/**
 * /commit 命令的完整工作流提示词
 *
 * 自 V1 config 钩子中的 template 字符串逐字迁移，
 * 由 registerCommitCommand 在用户执行 /commit 时作为 prompt 提交。
 */
export const COMMIT_TEMPLATE = `依次调用 git-diff、git-status、git-log 收集变更上下文，再调用 commit-message-generate 获取格式指南，然后根据上下文和指南生成一条中文提交信息。绝大多数情况只需一行 subject，不要生成 body。生成后立即调用 commit-message-validate 验证格式，如果验证失败，根据错误建议修正后重新验证，直到验证通过。验证通过后用 question 工具让用户确认：1. question 内容为 "确认提交以下信息？\\n\\n<完整提交信息>"；2. 设置 custom: true；3. 选项：确认提交、重新生成、取消。如果用户选择"重新生成"，则先调用 git-status、git-diff 检测工作区未提交的文件，然后重新生成提交信息并再次验证和确认。用户确认后调用 commit-message-confirm 提交。提交成功后，调用 git remote 检查是否存在远程仓库。如果存在远程仓库（git remote 输出非空），用 question 工具询问用户："提交成功，是否需要执行 git push？"设置 custom: true，选项：执行 push、不需要。用户选择"执行 push"时调用 git-push 工具。`

/**
 * 注册 /commit 斜杠命令
 *
 * V2 插件命令为程序化注册：用户执行 /commit 时，
 * 将工作流提示词（可附加用户输入）提交到当前会话。
 *
 * @param ctx - 插件上下文的 command 与 session 域
 * @returns 命令注册句柄
 */
export const registerCommitCommand = async (
  ctx: Pick<Context, 'command' | 'session'>,
): Promise<Registration> => {
  return ctx.command.transform((editor) => {
    editor.add({
      name: 'commit',
      description: '根据变更内容生成中文提交信息，确认后提交',
      async execute(invocation) {
        // 用户在 /commit 后附加的额外要求（可空）
        const extra = invocation.prompt.text?.trim()

        // 将工作流提示词提交到当前会话，透传投递模式
        await ctx.session.prompt({
          sessionID: invocation.sessionID,
          text: extra ? `${COMMIT_TEMPLATE}\n\n${extra}` : COMMIT_TEMPLATE,
          delivery: invocation.delivery,
        })
      },
    })
  })
}
