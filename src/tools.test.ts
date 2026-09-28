import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { commitAndReport, createConfirmTool } from './tools.js'
import type { CommitConfig } from './config.js'

/** 测试用提交配置 */
const testConfig: CommitConfig = { types: ['feat', 'fix', 'chore'], maxLength: 72 }

/** 初始化带初始提交的临时仓库并返回其路径 */
const initTempRepo = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'opencode', 'commit-report-'))
  await $`git init -q`.cwd(dir).quiet()
  await $`git config user.email t@t`.cwd(dir).quiet()
  await $`git config user.name t`.cwd(dir).quiet()
  await writeFile(join(dir, 'a.txt'), 'hello\n')
  await $`git add -A`.cwd(dir).quiet()
  const msg = 'chore: 🔧 初始化项目'
  await $`git commit -q -m ${msg}`.cwd(dir).quiet()
  return dir
}

describe('commitAndReport', () => {
  test('在指定 cwd 的仓库提交，不受进程目录影响', async () => {
    const dir = await initTempRepo()
    try {
      // 制造变更并暂存（与真实流程一致：collectGitContext 已先 git add -A）
      await writeFile(join(dir, 'feature.txt'), 'new feature\n')
      await $`git add -A`.cwd(dir).quiet()
      // 进程 cwd 是本仓库（worktree），cwd 参数指向临时仓库——提交必须落在临时仓库
      const result = await commitAndReport('feat: ✨ 快速模式提交', testConfig, '', dir)

      expect(result.info?.branch).toBe('master')
      expect(result.info?.hash).not.toBe('unknown')

      const log = await $`git log --oneline`.cwd(dir).text()
      expect(log).toContain('feat: ✨ 快速模式提交')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('没有可提交变更时返回提示文案', async () => {
    const dir = await initTempRepo()
    try {
      const result = await commitAndReport('feat: ✨ 无变更提交', testConfig, '', dir)
      expect(result.content).toContain('没有需要提交的变更')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('createConfirmTool', () => {
  test('提交信息未通过验证时拒绝提交并返回建议文案', async () => {
    // maxLength: 10，消息远超限制 → 应在执行 git 前被验证拦截
    const config: CommitConfig = { types: ['feat'], maxLength: 10 }
    const tool = createConfirmTool(config)

    const result = await tool.execute(
      { message: 'feat: 这条提交信息远远超过十个字符的限制' },
      { progress: async () => {} } as never,
    )

    // V2 返回 { content }，文案为校验错误 + 修正建议（未执行 git 即被拦截）
    const content = typeof result === 'string' ? result : result.content
    expect(String(content)).toContain('提交信息超过 10 个字符')
    expect(String(content)).toContain('请更简洁')
  })
})
