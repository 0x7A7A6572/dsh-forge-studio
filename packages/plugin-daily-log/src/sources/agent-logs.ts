/**
 * Agent 会话文件共享工具：从会话文件头部提取工作目录（cwd）。
 * claude / codex 的 transcript 头部行都携带工作目录，用于把会话归属到项目路径。
 * 归属一律做大小写不敏感归一化（Windows 盘符大小写/尾斜杠差异），
 * 但保留首个出现的原始文本作为可持久化路径。
 */

import { open } from 'node:fs/promises'

/** cwd 归一化 key：去尾斜杠 + 统一 \ → / + 小写。 */
export function normalizeCwd(p: string): string {
  return p.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

/** 从文件头部提取 cwd（首部 summary/init/rollout-meta 行通常带 "cwd"）。 */
export async function fileCwd(file: string): Promise<string | undefined> {
  let fd: Awaited<ReturnType<typeof open>> | undefined
  try {
    fd = await open(file, 'r')
    const buf = Buffer.alloc(16384)
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0)
    for (const line of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (!line.includes('"cwd"')) continue
      try {
        const obj = JSON.parse(line) as { payload?: { cwd?: unknown }; cwd?: unknown }
        const cwd = obj.payload?.cwd ?? obj.cwd
        if (typeof cwd === 'string' && cwd !== '') return cwd
      } catch {
        // 跳过解析失败的行
      }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    await fd?.close().catch(() => undefined)
  }
}
