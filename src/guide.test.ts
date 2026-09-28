import { describe, expect, test } from 'bun:test'
import { COMMIT_GUIDE } from './guide.js'

describe('COMMIT_GUIDE', () => {
  test('保持精简：不超过 25 行（控制生成 prompt 的输入 token）', () => {
    expect(COMMIT_GUIDE.split('\n').length).toBeLessThan(25)
  })

  test('覆盖全部 9 个提交类型', () => {
    const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'revert']
    for (const t of types) expect(COMMIT_GUIDE).toContain(t)
  })

  test('保留核心规则：长度限制、emoji 位置、无 body 默认', () => {
    expect(COMMIT_GUIDE).toContain('20 字以内')
    expect(COMMIT_GUIDE).toContain('emoji')
    expect(COMMIT_GUIDE).toContain('body')
  })
})
