import { describe, expect, test } from 'bun:test'
import { createConfirmTool } from './tools.js'
import type { CommitConfig } from './config.js'

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
