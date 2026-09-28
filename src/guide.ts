import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 内置的中文约定式提交格式指南
 *
 * 当项目根目录不存在 COMMITS.md 自定义指南时，
 * 使用此默认指南作为提交信息生成参考。
 */
export const COMMIT_GUIDE = `## 提交信息格式（严格遵循）

格式：\`<type>: <emoji> <subject>\`
类型：feat ✨ / fix 🐛 / docs 📝 / style 💄 / refactor ♻️ / perf ⚡ / test ✅ / chore 🔧 / revert ⏪
- 中文 subject，20 字以内，不加句号，emoji 放在 subject 开头
- 默认不写 body；仅当变更涉及 3 个以上独立模块且 subject 无法涵盖时，用最多 3 条 "- " 列出关键项
示例：feat: ✨ 添加用户登录功能

只输出提交信息本身，不要任何解释、引号或代码块标记。`

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
