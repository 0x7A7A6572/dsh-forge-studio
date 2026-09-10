import { describe, expect, it } from 'vitest'
import { dailyLogWriteShouldAsk } from '../src/agent/tools.ts'

describe('dailyLogWriteShouldAsk（pre-execute ask 门禁判定）', () => {
  it('宿主未装配 approval（无 seam）→ 放行，不弹确认', () => {
    expect(dailyLogWriteShouldAsk(undefined)).toBe(false)
  })

  it('会话策略 never（禁弹窗，ask 被确定性拒绝）→ 放行，不弹确认', () => {
    expect(dailyLogWriteShouldAsk('never')).toBe(false)
  })

  it('会话策略 ask（宿主会真正弹确认）→ 写工具先 ask', () => {
    expect(dailyLogWriteShouldAsk('ask')).toBe(true)
  })
})
