import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_TYPES, DEFAULT_MAX_LENGTH, loadConfig } from './config.js'

/** 默认配置的期望值（types 长度 9、maxLength 72、无 scopes） */
const defaultConfig = {
  types: [...DEFAULT_TYPES],
  maxLength: DEFAULT_MAX_LENGTH,
}

describe('loadConfig', () => {
  const dirs: string[] = []

  // 创建临时目录并在其中写入 opencode-commit.json
  const makeDir = async (content?: string): Promise<string> => {
    const dir = await mkdtemp(join('/tmp/opencode', 'opencode-commit-test-'))
    dirs.push(dir)
    if (content !== undefined) {
      await writeFile(join(dir, 'opencode-commit.json'), content, 'utf-8')
    }
    return dir
  }

  beforeAll(async () => {
    // 确保 /tmp/opencode 存在（环境通常已预创建）
    await mkdir('/tmp/opencode', { recursive: true })
  })

  afterAll(async () => {
    // 清理全部临时目录
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  })

  test('配置文件不存在时返回默认配置', async () => {
    const dir = await makeDir()
    const config = await loadConfig(dir)
    expect(config).toEqual(defaultConfig)
    expect(config.scopes).toBeUndefined()
  })

  test('完整合法配置的三个字段全部生效', async () => {
    const dir = await makeDir(
      JSON.stringify({ types: ['feat'], scopes: { a: ['x'] }, maxLength: 50 }),
    )
    const config = await loadConfig(dir)
    expect(config).toEqual({ types: ['feat'], scopes: { a: ['x'] }, maxLength: 50 })
  })

  test('空对象配置返回默认值', async () => {
    const dir = await makeDir('{}')
    const config = await loadConfig(dir)
    expect(config).toEqual(defaultConfig)
  })

  test('非法 JSON 返回默认配置', async () => {
    const dir = await makeDir('not json')
    const config = await loadConfig(dir)
    expect(config).toEqual(defaultConfig)
  })

  test('types 类型错误时整体回退默认配置', async () => {
    const dir = await makeDir(JSON.stringify({ types: 'feat' }))
    const config = await loadConfig(dir)
    expect(config).toEqual(defaultConfig)
  })

  test('maxLength 非数字时整体回退默认配置', async () => {
    const dir = await makeDir(JSON.stringify({ maxLength: '72' }))
    const config = await loadConfig(dir)
    expect(config).toEqual(defaultConfig)
  })

  test('scopes 值非 string 数组时整体回退默认配置', async () => {
    const dir = await makeDir(JSON.stringify({ scopes: { a: 'x' } }))
    const config = await loadConfig(dir)
    expect(config).toEqual(defaultConfig)
  })

  test('未知字段被忽略，已知字段生效', async () => {
    const dir = await makeDir(JSON.stringify({ types: ['feat'], unknown: 1 }))
    const config = await loadConfig(dir)
    expect(config).toEqual({ types: ['feat'], maxLength: DEFAULT_MAX_LENGTH })
  })
})
