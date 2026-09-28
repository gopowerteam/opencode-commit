import { Plugin } from '@opencode/plugin'
import { loadConfig } from './config.js'
import { registerCommitCommand } from './command.js'
import {
  createAmendTool,
  createConfirmTool,
  createDiffTool,
  createGenerateTool,
  createLogTool,
  createPushTool,
  createStatusTool,
  createUndoTool,
  createValidateTool,
} from './tools.js'

/**
 * OpenCode 中文约定式提交插件（V2）
 *
 * 注册 /commit 命令及一系列 git 操作工具，帮助用户
 * 按照约定式提交规范生成、验证并提交中文提交信息。
 */
export default Plugin.define({
  /** 稳定插件 ID，存储与诊断按此归属 */
  id: 'opencode-commit',

  /**
   * 插件加载入口
   *
   * 加载项目级配置（opencode-commit.json，不存在则使用默认值），
   * 注册 /commit 命令与全部自定义工具。
   *
   * @param ctx - OpenCode V2 插件上下文
   * @returns 清理函数（当前无持有资源，省略）
   */
  async setup(ctx) {
    // 项目根目录（工具与命令均在该项目内工作）
    const directory = ctx.location.directory
    const commitConfig = await loadConfig(directory)

    // 注册 /commit 斜杠命令（程序化编排）
    await registerCommitCommand(ctx, directory, commitConfig)

    // 注册全部自定义工具（git 类工具显式绑定项目根目录）
    await ctx.tool.transform((editor) => {
      editor.add(createGenerateTool(commitConfig, directory)) // 生成提交格式指南
      editor.add(createValidateTool(commitConfig)) // 验证提交信息格式
      editor.add(createConfirmTool(commitConfig, directory)) // 确认并提交
      editor.add(createAmendTool(commitConfig, directory)) // 修改最近一次提交
      editor.add(createDiffTool(directory)) // 查看暂存区差异
      editor.add(createLogTool(directory)) // 查看提交历史
      editor.add(createPushTool(directory)) // 推送到远程仓库
      editor.add(createStatusTool(directory)) // 查看工作树状态
      editor.add(createUndoTool(directory)) // 撤销最近提交
    })
  },
})
