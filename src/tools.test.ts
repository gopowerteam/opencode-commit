import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { commitAndReport, createConfirmTool, runPush } from './tools.js'
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

describe('runPush', () => {
  /** 建一对 bare 远程 + 本地工作仓库（本地含一次提交），返回两者路径 */
  const initRemotePair = async (): Promise<{ remote: string; local: string }> => {
    const remote = await mkdtemp(join(tmpdir(), 'opencode', 'push-remote-'))
    await $`git init -q --bare`.cwd(remote).quiet()
    const local = await mkdtemp(join(tmpdir(), 'opencode', 'push-local-'))
    await $`git init -q`.cwd(local).quiet()
    await $`git config user.email t@t`.cwd(local).quiet()
    await $`git config user.name t`.cwd(local).quiet()
    await $`git remote add origin ${remote}`.cwd(local).quiet()
    await writeFile(join(local, 'a.txt'), 'hello\n')
    await $`git add -A`.cwd(local).quiet()
    const msg = 'chore: 🔧 初始化项目'
    await $`git commit -q -m ${msg}`.cwd(local).quiet()
    return { remote, local }
  }

  test('无远程仓库时返回提示文案且不算成功', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opencode', 'push-noremote-'))
    try {
      await $`git init -q`.cwd(dir).quiet()
      const result = await runPush(dir)
      expect(result.ok).toBe(false)
      expect(result.content).toContain('没有配置远程仓库')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('缺少上游分支时自动 set-upstream 重试一次', async () => {
    const { remote, local } = await initRemotePair()
    try {
      // 首次推送：分支无 upstream → 应自动以 --set-upstream 重试并成功
      const result = await runPush(local)
      expect(result.ok).toBe(true)
      expect(result.content).toContain('推送成功')

      // 推送确实落到远端
      const remoteLog = await $`git log --oneline`.cwd(remote).text()
      expect(remoteLog).toContain('chore: 🔧 初始化项目')
    } finally {
      await rm(remote, { recursive: true, force: true })
      await rm(local, { recursive: true, force: true })
    }
  })

  test('已有上游分支时直接推送成功', async () => {
    const { remote, local } = await initRemotePair()
    try {
      // 先手动建立 upstream，第二次推送走常规路径
      await $`git push --set-upstream origin master`.cwd(local).nothrow().quiet()
      await writeFile(join(local, 'b.txt'), 'second\n')
      await $`git add -A`.cwd(local).quiet()
      const msg = 'feat: ✨ 第二次提交'
      await $`git commit -q -m ${msg}`.cwd(local).quiet()

      const result = await runPush(local)
      expect(result.ok).toBe(true)
      expect(result.content).toContain('推送成功')

      const remoteLog = await $`git log --oneline`.cwd(remote).text()
      expect(remoteLog).toContain('feat: ✨ 第二次提交')
    } finally {
      await rm(remote, { recursive: true, force: true })
      await rm(local, { recursive: true, force: true })
    }
  })
})

describe('createConfirmTool', () => {
  test('提交信息未通过验证时拒绝提交并返回建议文案', async () => {
    // maxLength: 10，消息远超限制 → 应在执行 git 前被验证拦截（directory 不会被触达）
    const config: CommitConfig = { types: ['feat'], maxLength: 10 }
    const tool = createConfirmTool(config, '/tmp/opencode/unused')

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
