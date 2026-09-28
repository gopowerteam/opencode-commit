import { describe, expect, test } from 'bun:test'
import { COMMIT_GUIDE } from './guide.js'
import { buildConfirmPrompt, buildGeneratePrompt } from './prompt.js'

const sampleContext = {
  status: ' M src/a.ts\n?? new.txt',
  diff: 'diff --git a/src/a.ts b/src/a.ts\n+新增一行',
  log: 'abc1234 feat: ✨ 历史提交\ndef5678 fix: 🐛 修复问题',
}

describe('buildGeneratePrompt', () => {
  test('包含格式指南与只输出指令', () => {
    const prompt = buildGeneratePrompt({ guide: COMMIT_GUIDE, context: sampleContext })
    // 指南核心规则在场
    expect(prompt).toContain('<type>: <emoji> <subject>')
    expect(prompt).toContain('20 字以内')
    // 明确的只输出约束
    expect(prompt).toContain('只输出')
  })

  test('包含三段 git 上下文', () => {
    const prompt = buildGeneratePrompt({ guide: COMMIT_GUIDE, context: sampleContext })
    expect(prompt).toContain('?? new.txt')
    expect(prompt).toContain('+新增一行')
    expect(prompt).toContain('feat: ✨ 历史提交')
  })

  test('未暂存变更（untracked）在工作区状态中标明', () => {
    const prompt = buildGeneratePrompt({ guide: COMMIT_GUIDE, context: sampleContext })
    expect(prompt).toContain('工作区状态')
    expect(prompt).toContain('变更差异')
    expect(prompt).toContain('最近提交')
  })

  test('附带用户额外要求并要求模型结合', () => {
    const prompt = buildGeneratePrompt({
      guide: COMMIT_GUIDE,
      context: sampleContext,
      extra: 'subject 里加上模块名',
    })
    expect(prompt).toContain('subject 里加上模块名')
  })
})

describe('buildConfirmPrompt', () => {
  test('包含提交信息、三选项与防摇摆指令', () => {
    const prompt = buildConfirmPrompt({ message: 'feat: ✨ 添加用户登录功能' })
    expect(prompt).toContain('feat: ✨ 添加用户登录功能')
    // 确认交互三选项
    expect(prompt).toContain('确认提交')
    expect(prompt).toContain('重新生成')
    expect(prompt).toContain('取消')
    // 已获授权声明 + 单一职责约束（防模型反复推理）
    expect(prompt).toContain('用户已通过 /commit 明确要求完成提交')
    expect(prompt).toContain('commit-message-confirm')
    expect(prompt).toContain('不要重复询问')
  })

  test('默认不包含推送环节', () => {
    const prompt = buildConfirmPrompt({ message: 'feat: ✨ 添加用户登录功能' })
    expect(prompt).not.toContain('git-push')
  })

  test('push 注入：确认后调用 git-push 并加入工具白名单', () => {
    const prompt = buildConfirmPrompt({ message: 'feat: ✨ 添加用户登录功能', push: true })
    expect(prompt).toContain('git-push')
    // 白名单与步骤里都要有推送动作
    expect(prompt).toContain('推送')
  })
})

