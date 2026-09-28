import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { collectGitContext } from './context.js'
import { MAX_DIFF_LINES } from './guide.js'

/** 测试用临时 git 仓库根目录 */
let repoDir: string

/**
 * 初始化一个带初始提交的真实 git 仓库
 *
 * @param dir - 仓库目录
 */
const initRepo = async (dir: string): Promise<void> => {
  await $`git init -q`.cwd(dir)
  await $`git config user.email test@test.com`.cwd(dir)
  await $`git config user.name test`.cwd(dir)
  await writeFile(join(dir, 'init.txt'), 'initial\n')
  await $`git add -A`.cwd(dir)
  // Bun Shell 模板字面量中的非 ASCII 字符会被转义，emoji 信息必须经变量插值传入
  const msg = 'feat: ✨ 初始提交'
  await $`git commit -q -m ${msg}`.cwd(dir)
}

beforeAll(async () => {
  await mkdirSafe()
  repoDir = await mkdtemp(join(TMP_ROOT, 'context-test-'))
  await initRepo(repoDir)
})

afterAll(async () => {
  await rm(repoDir, { recursive: true, force: true })
})

/** /tmp/opencode 根目录（已预创建） */
const TMP_ROOT = join(tmpdir(), 'opencode')

/** 确保 /tmp/opencode 存在（兜底） */
const mkdirSafe = async (): Promise<void> => {
  await $`mkdir -p ${TMP_ROOT}`.quiet()
}

describe('collectGitContext', () => {
  test('收集 status、diff、log 三段上下文', async () => {
    // 准备：修改已有文件 + 新增文件（未暂存）
    await appendFile(join(repoDir, 'init.txt'), 'changed line\n')
    await writeFile(join(repoDir, 'new.txt'), 'new file\n')

    const result = await collectGitContext(repoDir)

    expect(result.error).toBeNull()
    if (result.error) return
    // log 包含初始提交
    expect(result.data.log).toContain('feat: ✨ 初始提交')
    // status 反映工作区状态
    expect(result.data.status).toContain('new.txt')
    // diff 包含未暂存的修改内容
    expect(result.data.diff).toContain('changed line')
  })

  test('存在未暂存变更时自动 git add -A', async () => {
    await writeFile(join(repoDir, 'auto-stage.txt'), 'to be staged\n')

    await collectGitContext(repoDir)

    // 收集后变更应已被暂存
    const staged = await $`git diff --cached --name-only`.cwd(repoDir).text()
    expect(staged).toContain('auto-stage.txt')
  })

  test('无变更时返回干净的 status 与空 diff', async () => {
    // 先清空暂存区与工作区（提交掉之前的变更）
    await $`git add -A`.cwd(repoDir)
    const msg = 'chore: 🔧 清理测试变更'
    await $`git commit -q -m ${msg}`.cwd(repoDir)

    const result = await collectGitContext(repoDir)

    expect(result.error).toBeNull()
    if (result.error) return
    // porcelain 输出为空表示工作区干净
    expect(result.data.status.trim()).toBe('')
    expect(result.data.diff.trim()).toBe('')
    expect(result.data.log).toContain('chore: 🔧 清理测试变更')
  })

  test('超过 MAX_DIFF_LINES 的 diff 被截断并附省略提示', async () => {
    // 生成超过 500 行的变更
    const lines = Array.from({ length: MAX_DIFF_LINES + 100 }, (_, i) => `line ${i}\n`)
    await writeFile(join(repoDir, 'big.txt'), lines.join(''))
    await $`git add -A`.cwd(repoDir)

    const result = await collectGitContext(repoDir)

    expect(result.error).toBeNull()
    if (result.error) return
    expect(result.data.diff.split('\n').length).toBeLessThanOrEqual(MAX_DIFF_LINES + 5)
    expect(result.data.diff).toContain('已截断')
  })

  test('非 git 仓库返回 error', async () => {
    const plainDir = await mkdtemp(join(TMP_ROOT, 'not-repo-'))
    try {
      const result = await collectGitContext(plainDir)
      expect(result.error).not.toBeNull()
    } finally {
      await rm(plainDir, { recursive: true, force: true })
    }
  })
})
