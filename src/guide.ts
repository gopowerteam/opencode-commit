import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 内置的中文约定式提交格式指南
 *
 * 当项目根目录不存在 COMMITS.md 自定义指南时，
 * 使用此默认指南作为提交信息生成参考。
 */
export const COMMIT_GUIDE = `## 提交信息格式要求

你必须严格按照以下规范生成提交信息。

### 格式
\`\`\`
<type>: <emoji> <subject>
\`\`\`

### 类型与对应 emoji
- feat: 新功能 ✨
- fix: 修复 bug 🐛
- docs: 文档更新 📝
- style: 代码格式化 💄
- refactor: 重构代码 ♻️
- perf: 性能优化 ⚡
- test: 测试相关 ✅
- chore: 构建/依赖更新 🔧
- revert: 回滚提交 ⏪

### 规则
1. 提交信息使用中文
2. subject 简洁总结变更，20 字以内，不加句号
3. emoji 放在 subject 开头
4. **不要写 body**。除非变更涉及 3 个以上独立模块且 subject 无法涵盖，才用 body 列出关键项（"- " 开头，最多 3 条）
5. 根据变更选择最合适的 type 和 emoji

### 示例
\`\`\`
feat: ✨ 添加用户登录功能
\`\`\`
\`\`\`
fix: 🐛 修复首页白屏问题
\`\`\`
\`\`\`
chore: 🔧 升级依赖版本
\`\`\`
\`\`\`
refactor: ♻️ 重构用户模块
- 拆分认证逻辑为独立服务
- 提取公共权限校验函数
- 统一错误处理策略
\`\`\``

/** diff 输出的最大行数限制，超过此值将截断 */
export const MAX_DIFF_LINES = 500

/**
 * 加载提交格式指南
 *
 * 优先读取项目根目录的 COMMITS.md 自定义指南，
 * 不存在或读取失败时回退内置指南。
 *
 * @param directory - 项目根目录
 * @returns 格式指南文本
 */
export const loadGuide = async (directory: string): Promise<string> => {
  try {
    const content = await readFile(join(directory, 'COMMITS.md'), 'utf-8')
    const trimmed = content.trim()
    if (trimmed) return trimmed
  } catch {
    // 文件不存在或不可读，回退内置指南
  }
  return COMMIT_GUIDE
}
