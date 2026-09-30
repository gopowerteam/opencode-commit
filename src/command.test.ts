import { describe, expect, test } from 'bun:test'
import { CommitError } from './errors.js'
import { buildProgressMessage, extractMessage, generateValidMessage, parseCommitArgs, resolveModel } from './command.js'

describe('parseCommitArgs', () => {
  test('-y 标记快速模式', () => {
    expect(parseCommitArgs('-y')).toEqual({ fast: true, push: false, extra: undefined })
  })

  test('--yes 同样生效', () => {
    expect(parseCommitArgs('--yes')).toEqual({ fast: true, push: false, extra: undefined })
  })

  test('-y 后可跟额外要求', () => {
    expect(parseCommitArgs('-y subject 里带上模块名')).toEqual({
      fast: true,
      push: false,
      extra: 'subject 里带上模块名',
    })
  })

  test('--push 单独使用：仅自动推送', () => {
    expect(parseCommitArgs('--push')).toEqual({ fast: false, push: true, extra: undefined })
  })

  test('-y 与 --push 组合且顺序无关', () => {
    expect(parseCommitArgs('-y --push')).toEqual({ fast: true, push: true, extra: undefined })
    expect(parseCommitArgs('--push -y')).toEqual({ fast: true, push: true, extra: undefined })
  })

  test('标志与额外要求混排时其余文本聚合为 extra', () => {
    expect(parseCommitArgs('-y --push 加上 scope')).toEqual({
      fast: true,
      push: true,
      extra: '加上 scope',
    })
    expect(parseCommitArgs('加上 scope --push')).toEqual({
      fast: false,
      push: true,
      extra: '加上 scope',
    })
  })

  test('普通文本非快速模式且作为额外要求', () => {
    expect(parseCommitArgs('拆分为两个提交')).toEqual({
      fast: false,
      push: false,
      extra: '拆分为两个提交',
    })
  })

  test('空文本非快速模式', () => {
    expect(parseCommitArgs('')).toEqual({ fast: false, push: false, extra: undefined })
    expect(parseCommitArgs(undefined)).toEqual({ fast: false, push: false, extra: undefined })
    expect(parseCommitArgs('   ')).toEqual({ fast: false, push: false, extra: undefined })
  })

  test('以 -y 开头但非独立标记不算快速模式', () => {
    expect(parseCommitArgs('-yolo 模式')).toEqual({
      fast: false,
      push: false,
      extra: '-yolo 模式',
    })
  })
})

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

describe('buildProgressMessage', () => {
  test('包含变更文件数与模型名', () => {
    const message = buildProgressMessage(
      { status: 'M  a.ts\nA  b.ts\n?? c.ts\n', diff: 'd', log: 'l' },
      { providerID: 'anthropic', id: 'claude-x' },
    )
    expect(message).toContain('3 个文件')
    expect(message).toContain('anthropic/claude-x')
    expect(message).toContain('正在生成提交信息')
  })

  test('无变更时不显示文件数', () => {
    const message = buildProgressMessage(
      { status: '', diff: '', log: 'l' },
      { providerID: 'openai', id: 'gpt-x' },
    )
    expect(message).toContain('未检测到文件变更')
    expect(message).toContain('openai/gpt-x')
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
