import { $ } from 'bun'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Info } from '@opencode/plugin/promise/tool'
import type { CommitConfig } from './config.js'
import { CommitError } from './errors.js'
import { COMMIT_GUIDE, MAX_DIFF_LINES } from './guide.js'
import { safe, safeAsync } from './safe.js'
import { validateCommitMessage } from './validator.js'

/** V2 工具定义类型 */
type V2Tool = Info

/** 空参数工具的 JSON Schema */
const emptyInput = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

/**
 * 格式化验证错误信息
 *
 * 当错误为 CommitError 且包含建议时，将建议追加到错误信息中；
 * 否则直接返回错误信息。
 *
 * @param error - 验证过程中产生的错误
 * @returns 格式化后的错误字符串
 */
export const formatValidationError = (error: Error): string => {
  if (error instanceof CommitError && error.suggestions.length > 0) {
    // 包含建议时，以列表形式追加
    return error.message + '\n\n建议:\n' + error.suggestions.map(s => `- ${s}`).join('\n')
  }
  return error.message
}

/**
 * 截断过长的 diff 输出
 *
 * 当 diff 行数超过 MAX_DIFF_LINES 限制时，截取前 N 行
 * 并附加省略提示，避免工具返回内容过大。
 *
 * @param diff - 原始 diff 字符串
 * @returns 截断后的 diff 字符串
 */
const truncateDiff = (diff: string): string => {
  // 按行拆分
  const lines = diff.split('\n')
  // 未超限则原样返回
  if (lines.length <= MAX_DIFF_LINES) return diff
  // 截取前 N 行并附加省略提示
  return (
    lines.slice(0, MAX_DIFF_LINES).join('\n') +
    `\n\n... (已截断，省略 ${lines.length - MAX_DIFF_LINES} 行)`
  )
}

/**
 * 执行 git commit 并报告结果
 *
 * 内部会先验证提交信息格式，然后执行 git commit，
 * 最后获取当前分支和 commit hash 生成报告。
 *
 * @param message - 提交信息
 * @param config - 提交配置
 * @param flag - 额外的 commit 标志，空字符串表示普通提交，'--amend' 表示修改提交
 * @returns 成功时返回内容、最终标题与分支/hash 信息，失败时仅返回错误内容
 */
const commitAndReport = async (
  message: string,
  config: CommitConfig,
  flag: '' | '--amend',
): Promise<{ content: string; title?: string; info?: { branch: string; hash: string } }> => {
  // 提交前先验证格式
  const validation = safe(() => validateCommitMessage(message, config))
  if (validation.error) {
    return { content: formatValidationError(validation.error) }
  }

  // 根据 flag 决定执行普通提交还是 amend 提交
  const cmd = flag === '--amend' ? $`git commit --amend -m ${message}` : $`git commit -m ${message}`
  const result = await safeAsync(() => cmd.text())
  if (result.error) {
    // 将错误转为字符串
    const msg = String(result.error.message || result.error)
    // 没有变更可提交
    if (msg.includes('nothing to commit')) {
      return { content: '> 没有需要提交的变更。' }
    }
    // pre-commit hook 失败
    if (msg.includes('pre-commit') || msg.includes('hook')) {
      return { content: `> Pre-commit hook 失败：${msg}` }
    }
    // 其他错误
    return { content: `> 提交失败：${msg}` }
  }

  // 获取提交后的短 hash
  const hashResult = await safeAsync(() => $`git rev-parse --short HEAD`.text())
  // 获取当前分支名
  const branchResult = await safeAsync(() => $`git branch --show-current`.text())

  // 提取并清理 hash 和分支名
  const hash = hashResult.data?.trim() ?? 'unknown'
  const branch = branchResult.data?.trim() ?? 'unknown'

  // 根据操作类型选择提示文案
  const action = flag === '--amend' ? '修改成功' : '提交成功'

  return {
    content: `✅ ${action}！\n- 分支: ${branch}\n- Hash: ${hash}\n\n${result.data}`,
    title: `✅ ${message}`,
    info: { branch, hash },
  }
}

/**
 * 创建提交信息验证工具
 *
 * 验证提交信息是否符合约定式提交格式（类型、作用域、长度等），
 * 在用户确认提交前调用。
 *
 * @param config - 提交配置
 * @returns 工具定义
 */
export const createValidateTool = (config: CommitConfig): V2Tool => {
  return {
    name: 'commit-message-validate',
    description: '验证提交信息是否符合约定式提交格式。在用户确认前调用，验证失败时根据建议修正后重新验证。',
    input: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '待验证的中文约定式提交信息' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    async execute(input) {
      // 安全执行验证逻辑
      const result = safe(() => validateCommitMessage((input as { message: string }).message, config))
      if (result.error) {
        return { content: `❌ 验证失败: ${formatValidationError(result.error)}` }
      }
      return { content: `✅ 验证通过: ${(input as { message: string }).message}` }
    },
  }
}

/**
 * 创建提交格式指南生成工具
 *
 * 优先读取项目根目录的 COMMITS.md 自定义指南文件，
 * 不存在时使用内置的默认格式指南。
 *
 * @param config - 提交配置
 * @param directory - 项目根目录（V2 工具 context 不含目录信息，由 setup 注入）
 * @returns 工具定义
 */
export const createGenerateTool = (config: CommitConfig, directory: string): V2Tool => {
  return {
    name: 'commit-message-generate',
    description: '返回中文约定式提交格式指南。优先读取项目根目录的 COMMITS.md，不存在则使用内置指南。',
    input: emptyInput,
    async execute(_input, context) {
      await context.progress({ title: '📋 返回提交格式指南' })

      // 尝试读取项目自定义指南文件
      const result = await safeAsync(async () => {
        const content = await readFile(join(directory, 'COMMITS.md'), 'utf-8')
        return content.trim()
      })

      // 自定义指南存在则返回
      if (result.data) {
        return { content: result.data }
      }

      // 降级为内置指南
      return { content: COMMIT_GUIDE }
    },
  }
}

/**
 * 创建提交确认工具
 *
 * 使用指定的提交信息执行 git commit，仅在用户确认后调用。
 *
 * @param config - 提交配置
 * @returns 工具定义
 */
export const createConfirmTool = (config: CommitConfig): V2Tool => {
  return {
    name: 'commit-message-confirm',
    description: '使用指定的提交信息提交暂存的变更。仅在用户确认后才调用此工具。',
    input: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '中文约定式提交信息，含 emoji' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const message = (input as { message: string }).message
      // 记录即将提交的信息
      await context.progress({ title: `🚀 ${message}` })

      // 执行提交并获取报告
      const result = await commitAndReport(message, config, '')
      if (!result.info) {
        // 无 info 表示提交失败，仅返回错误内容
        return { content: result.content }
      }

      // 提交成功，附带最终标题与元数据
      return { content: result.content, metadata: { title: result.title, ...result.info } }
    },
  }
}

/**
 * 创建提交修改（amend）工具
 *
 * 使用新的提交信息修改最近一次提交（git commit --amend）。
 *
 * @param config - 提交配置
 * @returns 工具定义
 */
export const createAmendTool = (config: CommitConfig): V2Tool => {
  return {
    name: 'git-amend',
    description: '使用新的验证过的提交信息修改最后一次提交',
    input: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '新的中文约定式提交信息' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    async execute(input, context) {
      const message = (input as { message: string }).message
      // 记录修改操作
      await context.progress({ title: `📝 修改提交: ${message}` })

      // 执行 amend 提交
      const result = await commitAndReport(message, config, '--amend')
      if (!result.info) {
        return { content: result.content }
      }

      // 修改成功，附带最终标题与元数据
      return { content: result.content, metadata: { title: result.title, ...result.info } }
    },
  }
}

/**
 * 创建 git diff 工具
 *
 * 显示当前暂存的变更差异。如果存在未暂存的变更，会自动执行 git add -A
 * 将所有变更暂存后再显示 diff。
 *
 * @returns 工具定义
 */
export const createDiffTool = (): V2Tool => {
  return {
    name: 'git-diff',
    description: '显示当前暂存的 diff。如果没有暂存的变更，会自动暂存所有变更。',
    input: {
      type: 'object',
      properties: {
        staged: { type: 'boolean', description: '显示暂存的变更（默认: true）' },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      // 默认显示暂存区变更
      const showStaged = (input as { staged?: boolean }).staged !== false

      // 检查是否有未暂存的变更（工作区 vs 暂存区）
      const unstagedResult = await safeAsync(() => $`git diff --stat`.text())
      if (unstagedResult.error) {
        const msg = String(unstagedResult.error.message || unstagedResult.error)
        if (msg.includes('not a git repository')) {
          return { content: '> 当前目录不是 Git 仓库。' }
        }
        return { content: `> 获取 diff 失败：${msg}` }
      }

      // 存在未暂存变更时自动 add 所有变更
      if (unstagedResult.data?.trim()) {
        await safeAsync(() => $`git add -A`.text())
        await context.progress({ title: '📦 自动暂存变更...' })
      }

      // 根据参数选择查看暂存区或工作区差异
      const flag = showStaged ? '--staged' : ''
      const result = await safeAsync(() => $`git diff ${flag}`.text())
      if (result.error) {
        return { content: `> 获取 diff 失败：${result.error.message}` }
      }

      const trimmed = result.data.trim()
      if (!trimmed) {
        return { content: showStaged ? '没有暂存的变更。' : '没有未暂存的变更。' }
      }

      // 返回 markdown diff 代码块，超长时截断
      return { content: `\`\`\`diff\n${truncateDiff(trimmed)}\n\`\`\`` }
    },
  }
}

/**
 * 创建 git log 工具
 *
 * 显示最近 N 条提交历史，使用 oneline 格式。
 *
 * @returns 工具定义
 */
export const createLogTool = (): V2Tool => {
  return {
    name: 'git-log',
    description: '显示最近的提交历史',
    input: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '显示的提交数量（默认: 10）' },
      },
      additionalProperties: false,
    },
    async execute(input) {
      // 默认显示 10 条
      const count = (input as { count?: number }).count ?? 10

      const result = await safeAsync(() => $`git log --oneline -n ${count}`.text())
      if (result.error) {
        return { content: `> 获取 git log 失败：${result.error.message}` }
      }

      const trimmed = result.data.trim()
      if (!trimmed) {
        return { content: '没有找到提交记录。' }
      }

      // 返回 markdown 代码块
      return { content: `\`\`\`\n${trimmed}\n\`\`\`` }
    },
  }
}

/**
 * 创建 git status 工具
 *
 * 显示当前工作树状态，包括已暂存、未暂存和未跟踪的文件。
 *
 * @returns 工具定义
 */
export const createStatusTool = (): V2Tool => {
  return {
    name: 'git-status',
    description: '显示工作树状态，包括暂存、未暂存和未跟踪的文件',
    input: emptyInput,
    async execute() {
      const result = await safeAsync(() => $`git status`.text())
      if (result.error) {
        return { content: `> 获取 git status 失败：${result.error.message}` }
      }

      return { content: `\`\`\`\n${result.data.trim()}\n\`\`\`` }
    },
  }
}

/**
 * 创建撤销提交工具
 *
 * 使用 git reset --soft 撤销最近的提交，变更保留在暂存区。
 *
 * @returns 工具定义
 */
export const createUndoTool = (): V2Tool => {
  return {
    name: 'git-undo',
    description: '撤销最近的提交，保留变更在暂存区',
    input: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '撤销的提交数量（默认: 1）' },
      },
      additionalProperties: false,
    },
    async execute(input) {
      // 默认撤销 1 个提交
      const count = (input as { count?: number }).count ?? 1

      // 软重置，保留变更在暂存区
      const result = await safeAsync(() => $`git reset --soft HEAD~${count}`.text())
      if (result.error) {
        return { content: `> 撤销提交失败：${result.error.message}` }
      }

      return { content: `已撤销 ${count} 个提交（变更保留在暂存区）` }
    },
  }
}

/**
 * 创建 git push 工具
 *
 * 执行 git push 并处理常见场景：无远程分支、需要 set-upstream 等。
 *
 * @returns 工具定义
 */
export const createPushTool = (): V2Tool => {
  return {
    name: 'git-push',
    description: '将当前分支推送到远程仓库',
    input: emptyInput,
    async execute(_input, context) {
      await context.progress({ title: '🚀 推送到远程仓库...' })

      // 检查是否有远程仓库
      const remoteResult = await safeAsync(() => $`git remote`.text())
      if (remoteResult.error || !remoteResult.data?.trim()) {
        return { content: '> 当前仓库没有配置远程仓库，无法推送。' }
      }

      // 执行 push
      const result = await safeAsync(() => $`git push`.text())
      if (result.error) {
        const msg = String(result.error.message || result.error)
        // 没有上游分支
        if (msg.includes('upstream') || msg.includes('set-upstream')) {
          return { content: '> 当前分支没有设置上游分支。请先执行：git push --set-upstream origin <branch-name>' }
        }
        // 被拒绝（可能需要 pull）
        if (msg.includes('rejected')) {
          return { content: '> 推送被拒绝，远程仓库有新的变更。请先执行：git pull --rebase' }
        }
        return { content: `> 推送失败：${msg}` }
      }

      return { content: `✅ 推送成功！\n\n\`\`\`\n${result.data.trim()}\n\`\`\`` }
    },
  }
}
