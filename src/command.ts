import type { Context } from '@opencode/plugin/promise/plugin'
import type { Registration } from '@opencode/plugin/promise/registration'
import type { CommitConfig } from './config.js'
import { collectGitContext, type GitContext } from './context.js'
import { CommitError } from './errors.js'
import { loadGuide } from './guide.js'
import { buildConfirmPrompt, buildGeneratePrompt } from './prompt.js'
import { safeAsync } from './safe.js'
import { commitAndReport, runPush } from './tools.js'
import { validateCommitMessage } from './validator.js'

/** 模型引用（与 GenerateTextInput.model 对齐） */
type ModelRef = { providerID: string; id: string; variant?: string }

/** 生成依赖（注入以便测试） */
type GenerateDeps = {
  /** 单次文本生成调用 */
  generate: (input: { model: ModelRef; prompt: string }) => Promise<{ text: string }>
  /** 提交信息校验，失败时抛出 CommitError */
  validate: (message: string) => void
  /** 提交格式指南 */
  guide: string
  /** git 上下文 */
  context: GitContext
  /** 生成所用模型 */
  model: ModelRef
  /** 用户附加要求（可空） */
  extra?: string
}

/** 一次失败尝试的记录（错误 + 本次模型输出） */
type FailedAttempt = {
  error: CommitError
  output: string
}

/** 重试上限：首次生成 + 一次修正重试 */
const MAX_GENERATE_ATTEMPTS = 2

/** 快速模式解析结果 */
type CommitArgs = {
  /** 是否跳过会话确认直接提交 */
  fast: boolean
  /** 提交后是否自动推送 */
  push: boolean
  /** 用户附加要求（可空） */
  extra?: string
}

/** /commit 支持的独立标志 token */
const COMMIT_FLAGS: Record<string, keyof Omit<CommitArgs, 'extra'>> = {
  '-y': 'fast',
  '--yes': 'fast',
  '--push': 'push',
}

/**
 * 解析 /commit 附加文本
 *
 * 支持 `-y` / `--yes`（快速模式）与 `--push`（提交后自动推送）
 * 任意组合、顺序无关；其余文本聚合为生成阶段的额外要求。
 * 标志必须独立成词（如 `-yolo` 不算快速标记）。
 *
 * @param text - 用户在 /commit 后附加的原始文本（可空）
 * @returns 标志与额外要求
 */
export const parseCommitArgs = (text?: string): CommitArgs => {
  const trimmed = text?.trim() || ''
  if (!trimmed) return { fast: false, push: false, extra: undefined }

  const rest: string[] = []
  const flags = { fast: false, push: false }

  for (const token of trimmed.split(/\s+/)) {
    const flag = COMMIT_FLAGS[token]
    if (flag) {
      flags[flag] = true
    } else {
      rest.push(token)
    }
  }

  const extra = rest.join(' ').trim() || undefined
  return { fast: flags.fast, push: flags.push, extra }
}

/**
 * 从模型输出中提取提交信息
 *
 * 容忍模型违反"只输出信息本身"的指令：
 * 剥离 markdown 代码块围栏，取首个非空行。
 *
 * @param text - 模型原始输出
 * @returns 提交信息
 */
export const extractMessage = (text: string): string => {
  const stripped = text.replace(/^```[a-z]*\n?/gm, '').replace(/```\s*$/gm, '')
  const line = stripped.split('\n').find((l) => l.trim())
  return (line ?? '').trim()
}

/**
 * 生成并通过校验的提交信息
 *
 * 首次生成失败（格式不符）时，把错误信息与修正建议
 * 追加进提示词后自动重试一次；仍失败则抛出最后一次错误。
 * 校验全程本地执行，不消耗额外模型往返。
 *
 * @param deps - 生成依赖（generate/validate 注入）
 * @returns 通过校验的提交信息
 * @throws {CommitError} 重试后仍未通过校验
 */
export const generateValidMessage = async (deps: GenerateDeps): Promise<string> => {
  const { generate, validate, guide, context, model, extra } = deps

  let prompt = buildGeneratePrompt({ guide, context, extra })
  let failed: FailedAttempt | null = null

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    if (failed) {
      // 修正重试：附上首次输出、错误信息与建议
      const suggestions = failed.error.suggestions.map((s) => `- ${s}`).join('\n')
      prompt =
        `${prompt}\n\n<上次生成>\n${failed.output}\n</上次生成>\n\n` +
        `<验证失败>\n${failed.error.message}\n${suggestions}\n</验证失败>\n\n` +
        `请修正后重新输出，仍然只输出提交信息本身。`
    }

    const result = await generate({ model, prompt })
    const message = extractMessage(result.text)

    try {
      validate(message)
      return message
    } catch (error) {
      failed = {
        error:
          error instanceof CommitError
            ? error
            : new CommitError(String(error instanceof Error ? error.message : error)),
        output: message,
      }
    }
  }

  throw failed?.error ?? new CommitError('生成失败')
}

/** 模型解析所需的最小上下文形状（真实 Context 结构兼容） */
type ModelSourceCtx = {
  session: {
    get(input: { sessionID: string }): Promise<{ model?: ModelRef }>
  }
  model: {
    default(): Promise<{ data: { providerID: string; id: string } | null }>
  }
}

/**
 * 解析 /commit 生成所用的模型
 *
 * 优先使用当前会话的模型（保持用户对会话模型的直觉一致），
 * 会话未指定时回退宿主默认模型；两者皆无返回 null。
 *
 * @param ctx - 插件上下文的 session 与 model 域
 * @param sessionID - 当前会话 ID
 * @returns 模型引用；无法确定时为 null
 */
export const resolveModel = async (
  ctx: ModelSourceCtx,
  sessionID: string,
): Promise<ModelRef | null> => {
  // 会话模型
  const session = await ctx.session.get({ sessionID })
  if (session?.model) {
    return { providerID: session.model.providerID, id: session.model.id, variant: session.model.variant }
  }

  // 宿主默认模型
  const fallback = await ctx.model.default()
  if (fallback?.data) {
    return { providerID: fallback.data.providerID, id: fallback.data.id }
  }

  return null
}

/**
 * 注册 /commit 斜杠命令（程序化编排版）
 *
 * 确定性工作全部在本地完成：收集上下文、读取指南、
 * 校验与失败重试均不经模型；模型只承担"生成提交信息"
 * 一次调用，以及会话内的确认交互。
 *
 * @param ctx - 插件上下文的 command、session 与 model 域
 * @param directory - 项目根目录（读取 COMMITS.md 与执行 git）
 * @param config - 提交配置
 * @returns 命令注册句柄
 */
export const registerCommitCommand = async (
  ctx: Pick<Context, 'command' | 'session' | 'model' | 'generate'>,
  directory: string,
  config: CommitConfig,
): Promise<Registration> => {
  return ctx.command.transform((editor) => {
    editor.add({
      name: 'commit',
      description: '根据变更内容生成中文提交信息，确认后提交',
      async execute(invocation) {
        // 解析附加参数：-y/--yes 快速模式、--push 自动推送，其余文本作为额外要求
        const { fast, push, extra } = parseCommitArgs(invocation.prompt.text)

        // 解析生成所用模型
        const model = await resolveModel(ctx, invocation.sessionID)
        if (!model) {
          await ctx.session.prompt({
            sessionID: invocation.sessionID,
            text: '无法确定可用模型（当前会话与默认模型均为空），请先在 OpenCode 中配置模型后再使用 /commit。',
            delivery: invocation.delivery,
          })
          return
        }

        // 本地读取格式指南（COMMITS.md 优先）与 git 上下文
        const guide = await loadGuide(directory)
        const collected = await collectGitContext(directory)

        if (collected.error) {
          await ctx.session.prompt({
            sessionID: invocation.sessionID,
            text: `/commit 收集变更上下文失败：${collected.error.message}\n请检查当前目录是否为 Git 仓库。`,
            delivery: invocation.delivery,
          })
          return
        }

        const generateDeps = {
          generate: (input: { model: ModelRef; prompt: string }) => ctx.generate.text(input),
          validate: (message: string) => validateCommitMessage(message, config),
          guide,
          context: collected.data,
          model,
          extra,
        }

        // 单次模型生成 + 本地校验重试
        let generated = await safeAsync(() => generateValidMessage(generateDeps))

        if (generated.error) {
          const reason =
            generated.error instanceof CommitError
              ? `${generated.error.message}\n建议:\n${generated.error.suggestions.map((s) => `- ${s}`).join('\n')}`
              : generated.error.message
          // 兜底路径：交回会话，由模型结合上下文直接修正并走原有确认流程
          await ctx.session.prompt({
            sessionID: invocation.sessionID,
            text:
              `/commit 自动生成未通过校验：${reason}\n` +
              '请调用 git-diff、git-status、git-log 查看变更，自行生成一条符合格式要求的中文提交信息，' +
              '然后调用 commit-message-validate 验证，通过后用 question 工具让用户确认（选项：确认提交、重新生成、取消），' +
              '确认后调用 commit-message-confirm 提交。',
            delivery: invocation.delivery,
          })
          return
        }

        // 快速模式：跳过会话确认，本地直接提交，synthetic 报告结果（零模型往返）
        if (fast) {
          const result = await commitAndReport(generated.data, config, '', directory)
          let report = result.content
          // --push：提交成功后本地推送，结果并入同一份报告
          if (push && result.info) {
            const pushed = await runPush(directory)
            report += `\n\n${pushed.content}`
          }
          await ctx.session.synthetic({
            sessionID: invocation.sessionID,
            text: `/commit 执行结果：\n\n${report}`,
          })
          return
        }

        // 确认阶段交回会话（V2 插件上下文无自建表单通道，question 工具是唯一宿主交互机制）
        await ctx.session.prompt({
          sessionID: invocation.sessionID,
          text: buildConfirmPrompt({ message: generated.data, push }),
          delivery: invocation.delivery,
        })
      },
    })
  })
}
