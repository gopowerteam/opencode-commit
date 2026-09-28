import { $ } from 'bun'
import { safeAsync, type SafeResult } from './safe.js'
import { truncateDiff } from './tools.js'

/** 本地收集的 git 变更上下文 */
export type GitContext = {
  /** git status --porcelain 输出（工作区状态摘要） */
  status: string
  /** 暂存区 diff（已按 MAX_DIFF_LINES 截断） */
  diff: string
  /** git log --oneline 最近提交（供参考历史风格） */
  log: string
}

/**
 * 本地一次性收集 /commit 所需的 git 上下文
 *
 * 与 git-diff 工具行为一致：存在未暂存变更时自动 `git add -A`，
 * 随后收集 status、暂存区 diff（截断）与最近提交历史。
 * 全程本地执行，不消耗任何模型推理回合。
 *
 * @param cwd - 执行 git 命令的目录，缺省为进程当前目录
 * @returns 收集结果；非 git 仓库等失败场景返回 error
 */
export const collectGitContext = async (cwd?: string): Promise<SafeResult<GitContext>> => {
  return safeAsync(async () => {
    const shell = (cmd: ReturnType<typeof $>) => (cwd ? cmd.cwd(cwd) : cmd)

    // 工作区状态（porcelain 单行摘要，便于注入提示词；含 untracked 文件）
    const status = await shell($`git status --porcelain`).text()

    // 存在待提交变更（含未跟踪新文件）时自动暂存（与 git-diff 工具行为一致）
    if (status.trim()) {
      await shell($`git add -A`).quiet()
    }

    // 暂存区 diff（截断，避免提示词过大）
    const rawDiff = await shell($`git diff --staged`).text()
    const diff = rawDiff.trim() ? truncateDiff(rawDiff.trim()) : ''

    // 最近提交历史（供模型参考本仓库的提交风格；显式 UTF-8 输出，避免 locale 转义）
    const log = await shell($`git -c i18n.logoutputencoding=UTF-8 log --oneline -n 10`).text()

    return { status, diff, log }
  })
}
