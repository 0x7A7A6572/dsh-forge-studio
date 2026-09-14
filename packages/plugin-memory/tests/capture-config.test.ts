/**
 * capture 高级配置：频次取模、转录窗口与料源开关、默认值。
 *
 * 不变量：
 * - 频次按 turn 序号取模，拿不到序号时兜底为触发（不能把自动提炼整个关掉）；
 * - 助手正文默认不入料（结论类记忆改由 agent 主动 memory_save 负责）；
 * - 窗口参数真的生效，默认值保持与既有行为可区分。
 */

import { describe, expect, it } from 'vitest'
import { collectTranscript, shouldCaptureNow } from '../src/agent/capture.ts'
import { MEMORY_CONFIG_BASE } from '../src/types.ts'

const userEvent = (text: string, kind = 'user') => ({
  type: 'user/message',
  data: { content: [{ type: 'text', text }], source: { kind } },
})
const assistantEvent = (text: string) => ({
  type: 'assistant/message',
  data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
})
const sessionOf = (events: unknown[]) => ({ snapshotEvents: () => events })

describe('提炼频次：每 N 轮一次', () => {
  it('N=3 时只在第 3、6 轮触发', () => {
    expect(shouldCaptureNow(1, 3)).toBe(false)
    expect(shouldCaptureNow(2, 3)).toBe(false)
    expect(shouldCaptureNow(3, 3)).toBe(true)
    expect(shouldCaptureNow(4, 3)).toBe(false)
    expect(shouldCaptureNow(6, 3)).toBe(true)
  })

  it('N=1 等于现状：每轮都触发', () => {
    for (const turn of [1, 2, 3, 7]) expect(shouldCaptureNow(turn, 1)).toBe(true)
  })

  it('拿不到轮次号时兜底触发，不会因为缺字段把自动提炼关掉', () => {
    expect(shouldCaptureNow(undefined, 3)).toBe(true)
    expect(shouldCaptureNow(0, 3)).toBe(true)
  })

  it('N 非法（0 / 负数 / 小数）按可用值处理，不抛错', () => {
    expect(shouldCaptureNow(2, 0)).toBe(true)
    expect(shouldCaptureNow(2, -1)).toBe(true)
    expect(shouldCaptureNow(2, 2.5)).toBe(true)
  })
})

describe('转录窗口与料源', () => {
  it('助手正文不入料：转录里只有用户的话', () => {
    const transcript = collectTranscript(sessionOf([
      userEvent('我喜欢简洁'),
      assistantEvent('明白了'),
    ]), 12, 12000, false)
    expect(transcript).toContain('用户：我喜欢简洁')
    expect(transcript).not.toContain('助手：明白了')
  })

  it('显式打开助手正文时恢复现状', () => {
    const transcript = collectTranscript(sessionOf([
      userEvent('我喜欢简洁'),
      assistantEvent('明白了'),
    ]), 12, 12000, true)
    expect(transcript).toContain('助手：明白了')
  })

  it('窗口轮数生效：只留最后 2 轮', () => {
    const many = [1, 2, 3, 4].flatMap((n) => [userEvent('问' + n), assistantEvent('答' + n)])
    const transcript = collectTranscript(sessionOf(many), 2, 12000, true)
    expect(transcript).toContain('用户：问4')
    expect(transcript).not.toContain('用户：问2')
  })

  it('字符上限生效：超长保留尾部', () => {
    const transcript = collectTranscript(sessionOf([
      userEvent('x'.repeat(200)),
      assistantEvent('y'.repeat(200)),
    ]), 12, 100, true)
    expect(transcript).toHaveLength(100)
  })

  it('默认参数保持既有行为（12 轮 / 12000 字 / 含助手）', () => {
    const transcript = collectTranscript(sessionOf([userEvent('默认行为'), assistantEvent('默认答复')]))
    expect(transcript).toContain('用户：默认行为')
    expect(transcript).toContain('助手：默认答复')
  })
})

describe('配置默认值', () => {
  it('默认：每 3 轮提炼、窗口 4 轮 / 4000 字、助手不入料、注入门槛 4', () => {
    expect(MEMORY_CONFIG_BASE.captureEveryTurns).toBe(3)
    expect(MEMORY_CONFIG_BASE.captureMaxTurns).toBe(4)
    expect(MEMORY_CONFIG_BASE.captureMaxChars).toBe(4000)
    expect(MEMORY_CONFIG_BASE.captureIncludeAssistant).toBe(false)
    expect(MEMORY_CONFIG_BASE.importanceThreshold).toBe(4)
  })
})
