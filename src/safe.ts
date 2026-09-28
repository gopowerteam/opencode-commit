/**
 * 安全执行结果类型
 *
 * 包含 data 或 error 两者之一，用于替代 try-catch 的异常处理模式。
 */
export type Result<T, E> =
  | { data: T; error: null }
  | { data: null; error: E }

/** 同步安全执行的结果类型，错误固定为 Error */
export type SafeResult<T> = Result<T, Error>

/**
 * 安全执行同步函数
 *
 * 捕获函数内部抛出的异常，将其转换为 { data, error } 结构返回，
 * 避免调用方需要 try-catch。
 *
 * @param fn - 需要安全执行的同步函数
 * @returns 包含 data 或 error 的结果对象
 */
export const safe = <T>(fn: () => T): SafeResult<T> => {
  try {
    // 正常执行，返回数据
    const data = fn()
    return { data, error: null }
  } catch (error) {
    // 捕获异常，统一转换为 Error 类型
    return {
      data: null,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

/**
 * 安全执行异步函数
 *
 * 捕获 Promise 中抛出的异常，将其转换为 { data, error } 结构返回，
 * 避免调用方需要 try-catch / .catch()。
 *
 * @param fn - 需要安全执行的异步函数
 * @returns 包含 data 或 error 的 Promise 结果对象
 */
export const safeAsync = async <T>(fn: () => Promise<T>): Promise<SafeResult<T>> => {
  try {
    // 等待异步执行完成，返回数据
    const data = await fn()
    return { data, error: null }
  } catch (error) {
    // 捕获异步异常，统一转换为 Error 类型
    return {
      data: null,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}
