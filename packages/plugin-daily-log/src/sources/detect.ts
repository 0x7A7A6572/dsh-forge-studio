/**
 * 项目类型探测（host 侧）：目录下存在 `.git`（目录或文件，含 worktree/submodule）
 * → 代码项目；否则 → 其他。探测失败一律按「其他」处理，绝不抛错。
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SourceType } from '../types.ts'

export async function detectProjectType(root: string): Promise<SourceType> {
  try {
    await stat(join(root, '.git'))
    return 'code'
  } catch {
    return 'other'
  }
}
