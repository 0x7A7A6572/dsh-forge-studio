/**
 * core/notes-stats 纯逻辑单测：徽标文案 openTaskText（0 隐藏、99+ 封顶）。
 * store/轮询/挂载依赖 window 与远程调用，不进 node 单测（由手动验证覆盖）。
 */

import { describe, expect, it } from 'vitest'
import { openTaskText } from '../src/client/core/notes-stats.ts'

describe('openTaskText（侧栏「待办 N」小签文案）', () => {
  it('0/负值 → 空串（调用方隐藏小签）', () => {
    expect(openTaskText(0)).toBe('')
    expect(openTaskText(-3)).toBe('')
  })

  it('>0 → 「待办 N」', () => {
    expect(openTaskText(1)).toBe('待办 1')
    expect(openTaskText(12)).toBe('待办 12')
  })

  it('>99 封顶为「待办 99+」（防撑坏行宽）', () => {
    expect(openTaskText(99)).toBe('待办 99')
    expect(openTaskText(100)).toBe('待办 99+')
    expect(openTaskText(1200)).toBe('待办 99+')
  })
})
