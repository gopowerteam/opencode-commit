import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeAsync } from './safe.js'

/** 默认支持的提交类型列表 */
export const DEFAULT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'revert',
] as const

/** 提交信息的默认最大字符长度 */
export const DEFAULT_MAX_LENGTH = 72

/** 配置文件解析后的可选字段结构 */
type RawConfig = {
  types?: string[]
  scopes?: Record<string, string[]>
  maxLength?: number
}

/** 解析后的提交配置 */
export type CommitConfig = {
  /** 允许的提交类型 */
  types: string[]
  /** 作用域映射表（键为类别，值为允许的作用域列表） */
  scopes?: Record<string, string[]>
  /** 提交信息最大字符长度 */
  maxLength: number
}

/** 判断值是否为普通对象（非 null、非数组） */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 判断值是否为 string 数组 */
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * 校验配置文件的原始结构
 *
 * 仅接受已知字段（types / scopes / maxLength），未知字段忽略。
 * 任一已存在字段类型不合法时返回 null，由调用方整体回退默认配置。
 *
 * @param value - JSON.parse 的解析结果
 * @returns 合法时返回提取的可选字段，不合法时返回 null
 */
export const parseRawConfig = (value: unknown): RawConfig | null => {
  // 非普通对象（如数组、字符串、null）直接判定不合法
  if (!isPlainObject(value)) return null

  // types 必须是 undefined 或 string 数组
  if (value.types !== undefined && !isStringArray(value.types)) return null

  // scopes 必须是 undefined 或"值为 string 数组的普通对象"
  if (value.scopes !== undefined) {
    if (!isPlainObject(value.scopes)) return null
    const scopesValid = Object.values(value.scopes).every((item) => isStringArray(item))
    if (!scopesValid) return null
  }

  // maxLength 必须是 undefined 或有限数字
  if (value.maxLength !== undefined && !(typeof value.maxLength === 'number' && Number.isFinite(value.maxLength))) {
    return null
  }

  return {
    types: value.types as string[] | undefined,
    scopes: value.scopes as Record<string, string[]> | undefined,
    maxLength: value.maxLength as number | undefined,
  }
}

/**
 * 加载项目级提交配置
 *
 * 从项目根目录读取 opencode-commit.json 配置文件，
 * 解析并合并默认值。文件不存在或格式错误时返回默认配置。
 *
 * @param directory - 项目根目录路径
 * @returns 合并后的提交配置
 */
export const loadConfig = async (directory: string): Promise<CommitConfig> => {
  // 拼接配置文件路径
  const configPath = join(directory, 'opencode-commit.json')

  // 安全读取并解析配置文件
  const result = await safeAsync(async () => {
    const raw = await readFile(configPath, 'utf-8')
    return parseRawConfig(JSON.parse(raw))
  })

  // 配置文件不存在或解析失败，使用默认值
  if (result.error || result.data === null) {
    return {
      types: [...DEFAULT_TYPES],
      maxLength: DEFAULT_MAX_LENGTH,
    }
  }

  // 合并用户配置与默认值
  return {
    types: result.data.types ?? [...DEFAULT_TYPES],
    scopes: result.data.scopes,
    maxLength: result.data.maxLength ?? DEFAULT_MAX_LENGTH,
  }
}

/**
 * 获取所有允许的作用域列表
 *
 * 将配置中的作用域映射表展平为一维数组。
 *
 * @param config - 提交配置
 * @returns 所有可能的作用域列表，未配置时返回 undefined
 */
export const getAllScopes = (config: CommitConfig): string[] | undefined => {
  // 未配置作用域则不限制
  if (!config.scopes) return undefined
  // 将所有类别下的作用域合并去重
  return Object.values(config.scopes).flat()
}
