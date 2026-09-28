import { afterAll, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const distDir = join(import.meta.dir, '..', 'dist')

test('发布产物外置 @opencode/plugin（不内联插件运行时）', async () => {
  // 执行真实构建
  const proc = Bun.spawnSync(['bun', 'run', 'build'], { cwd: join(import.meta.dir, '..') })
  if (proc.exitCode !== 0) {
    console.error(new TextDecoder().decode(proc.stderr))
  }
  expect(proc.exitCode).toBe(0)

  // dist/index.js 必须包含对 @opencode/plugin 的模块引用（external），
  // 而不是把插件运行时内联进产物
  const code = await Bun.file(join(distDir, 'index.js')).text()
  expect(code).toContain('@opencode/plugin"')
})

afterAll(async () => {
  // 清理构建产物，保持工作树干净（dist 本就被 gitignore）
  await rm(distDir, { recursive: true, force: true })
})
