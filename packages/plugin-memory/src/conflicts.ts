/**
 * 与其它记忆插件的冲突探测。
 *
 * 为什么必须有：tools 服务在同一层重名注册会**直接抛错**。装了 mneme 之后再装本
 * 插件，7 个 memory_* 里有 6 个重名，第一个 register 就会抛，整条 tools 桥被打崩，
 * 用户只看到「工具莫名其妙没了」。所以注册前先探测、跳过、上报。
 *
 * 能力边界（诚实说明）：
 * - 能探测**重名工具**——两个记忆插件都要给模型 memory_save 时，这是唯一会真正
 *   打架的地方，也是 100% 可靠的信号。
 * - 探测不到「只注入提示词、不注册工具」的记忆插件，也探测不到别人的面板分区
 *   （settings.section 是纯 client 侧注册，host 看不到）。
 */

import type { MemoryConflict } from './types.ts'

/** ctx.tools 的最小只读视图（只用到 get），便于测试注入假实现。 */
export interface ToolProbe {
  get(name: string): { description?: string } | undefined
}

/**
 * 逐个查工具名是否已被占用。tools 未就绪或查询抛错都按「无冲突」处理：
 * 探测失败绝不能变成阻塞注册的理由。
 */
export function detectToolConflicts(
  tools: ToolProbe | undefined,
  names: readonly string[],
): MemoryConflict[] {
  if (tools === undefined || typeof tools.get !== 'function') return []
  const conflicts: MemoryConflict[] = []
  for (const name of names) {
    let existing: { description?: string } | undefined
    try {
      existing = tools.get(name)
    } catch {
      existing = undefined
    }
    if (existing === undefined || existing === null) continue
    conflicts.push({
      name,
      description: typeof existing.description === 'string' ? existing.description : '',
    })
  }
  return conflicts
}

/** 冲突摘要：日志与面板共用同一句人话。 */
export function describeConflicts(conflicts: readonly MemoryConflict[]): string {
  if (conflicts.length === 0) return ''
  const names = conflicts.map((conflict) => conflict.name).join('、')
  return `检测到另一个记忆插件已占用 ${names}`
    + '，本次已跳过这些工具以免注册失败。同一个 profile 里建议只保留一个记忆插件。'
}
