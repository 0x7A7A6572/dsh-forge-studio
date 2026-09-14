/**
 * 自动保存调度器单测（假定时器）：防抖、在途补跑、取消、卸载。
 * 这是「编辑既有便签自动保存 + Ctrl+S 不关弹窗」的时序底座。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutoSaver } from '../src/client/core/auto-save.ts'

/** 可控 save：每次调用记一笔，手动决定何时完成。 */
function makeSave(): {
  readonly calls: () => number
  readonly save: () => Promise<void>
  readonly resolve: () => void
} {
  let calls = 0
  let pending: (() => void) | null = null
  return {
    calls: () => calls,
    save: () => {
      calls += 1
      return new Promise<void>((resolve) => {
        pending = resolve
      })
    },
    resolve: () => {
      const done = pending
      pending = null
      done?.()
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createAutoSaver', () => {
  it('改动后静置 delayMs 才落盘；期间再次改动只落一次', async () => {
    const fake = makeSave()
    const saver = createAutoSaver({ delayMs: 1000, retryMs: 500, save: fake.save })

    saver.touch()
    await vi.advanceTimersByTimeAsync(600)
    expect(fake.calls()).toBe(0)
    saver.touch() // 又改了一下：倒计时重置
    await vi.advanceTimersByTimeAsync(600)
    expect(fake.calls()).toBe(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.calls()).toBe(1)
    expect(saver.pending).toBe(false)
  })

  it('落盘在途时又到期：本次结束后隔 retryMs 补跑一次（写的是最新草稿）', async () => {
    const fake = makeSave()
    const saver = createAutoSaver({ delayMs: 1000, retryMs: 500, save: fake.save })

    saver.touch()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.calls()).toBe(1) // 第一次在途（未 resolve）

    saver.touch() // 在途期间的改动
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.calls()).toBe(1) // 在途：只记「待补」，不并发

    fake.resolve() // 第一次完成 → 排补跑
    await vi.advanceTimersByTimeAsync(500)
    expect(fake.calls()).toBe(2)
  })

  it('cancel 清掉未触发的定时器且不补跑（Ctrl+S 立即保存前用）', async () => {
    const fake = makeSave()
    const saver = createAutoSaver({ delayMs: 1000, retryMs: 500, save: fake.save })

    saver.touch()
    saver.cancel()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.calls()).toBe(0)
    expect(saver.pending).toBe(false)
  })

  it('dispose 后不再落盘，在途结束时也不重排', async () => {
    const fake = makeSave()
    const saver = createAutoSaver({ delayMs: 1000, retryMs: 500, save: fake.save })

    saver.touch()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.calls()).toBe(1)

    saver.touch()
    saver.dispose()
    fake.resolve()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fake.calls()).toBe(1)
  })
})
