import { describe, expect, test } from 'bun:test'
import { CommitError } from './errors.js'
import { extractMessage, generateValidMessage, resolveModel } from './command.js'

describe('extractMessage', () => {
  test('剥离代码块围栏', () => {
    expect(extractMessage('```\nfeat: ✨ 添加功能\n```')).toBe('feat: ✨ 添加功能')
  })

  test('取首个非空行', () => {
    expect(extractMessage('\n\nfix: 🐛 修复问题\n\n多余内容')).toBe('fix: 🐛 修复问题')
  })

  test('普通文本原样返回', () => {
    expect(extractMessage('docs: 📝 更新文档')).toBe('docs: 📝 更新文档')
  })
})

describe('generateValidMessage', () => {
  const base = {
    guide: 'GUIDE',
    context: { status: 's', diff: 'd', log: 'l' },
    model: { providerID: 'p', id: 'm' },
  }

  test('第一次生成即有效：仅调用一次', async () => {
    let calls = 0
    const message = await generateValidMessage({
      ...base,
      generate: async () => {
        calls++
        return { text: 'feat: ✨ 有效信息' }
      },
      validate: () => {},
    })
    expect(calls).toBe(1)
    expect(message).toBe('feat: ✨ 有效信息')
  })

  test('第一次无效：带上错误与建议重试一次', async () => {
    const prompts: string[] = []
    let calls = 0
    const message = await generateValidMessage({
      ...base,
      generate: async ({ prompt }) => {
        calls++
        prompts.push(prompt)
        if (calls === 1) return { text: 'invalid message' }
        return { text: 'feat: ✨ 修正后信息' }
      },
      validate: (msg) => {
        if (!msg.startsWith('feat')) {
          throw new CommitError(`无效的提交类型`, ['有效类型为: feat, fix'])
        }
      },
    })
    expect(calls).toBe(2)
    expect(message).toBe('feat: ✨ 修正后信息')
    // 重试 prompt 包含首次输出、错误信息与建议
    expect(prompts[1]).toContain('invalid message')
    expect(prompts[1]).toContain('无效的提交类型')
    expect(prompts[1]).toContain('有效类型为: feat, fix')
  })

  test('两次都无效：抛出最后一次错误', async () => {
    const expectation = expect(
      generateValidMessage({
        ...base,
        generate: async () => ({ text: 'still bad' }),
        validate: () => {
          throw new CommitError('无效的提交类型', ['有效类型为: feat'])
        },
      }),
    )
    await expectation.rejects.toThrow('无效的提交类型')
  })
})

describe('resolveModel', () => {
  test('优先使用会话模型', async () => {
    const model = await resolveModel(
      {
        session: {
          get: async () => ({ model: { providerID: 'anthropic', id: 'session-model' } }),
        },
        model: {
          default: async () => ({ data: { providerID: 'openai', id: 'default-model' } }),
        },
      },
      'ses_1',
    )
    expect(model).toEqual({ providerID: 'anthropic', id: 'session-model' })
  })

  test('会话无模型时回退默认模型', async () => {
    const model = await resolveModel(
      {
        session: { get: async () => ({}) },
        model: {
          default: async () => ({ data: { providerID: 'openai', id: 'default-model' } }),
        },
      },
      'ses_1',
    )
    expect(model).toEqual({ providerID: 'openai', id: 'default-model' })
  })

  test('两者皆无时返回 null', async () => {
    const model = await resolveModel(
      {
        session: { get: async () => ({}) },
        model: { default: async () => ({ data: null }) },
      },
      'ses_1',
    )
    expect(model).toBeNull()
  })
})
