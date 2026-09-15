import { describe, expect, it } from 'vitest'
import { DAILY_LOG_CONFIG_BASE, createDailyLogSettingsAccess, type DailyLogConfig } from '../src/settings.ts'

describe('enableReportCommand 设置项', () => {
  it('base 默认开启', () => {
    expect(DAILY_LOG_CONFIG_BASE.enableReportCommand).toBe(true)
  })
})

describe('DailyLogSettingsAccess', () => {
  it('未绑定 settings 时给出 base 默认值，ready() 为 false', () => {
    const access = createDailyLogSettingsAccess()
    expect(access.ready()).toBe(false)
    expect(access.get().enableReportCommand).toBe(true)
  })

  it('绑定后采用作用域的值，并在其变化时通知 watcher', () => {
    const access = createDailyLogSettingsAccess()
    const seen: boolean[] = []
    let push: ((next: DailyLogConfig) => void) | undefined
    access.watch((next) => seen.push(next.enableReportCommand))
    access.bind({
      get: () => ({ ...DAILY_LOG_CONFIG_BASE, enableReportCommand: false }),
      watch: (cb) => { push = cb; return () => {} },
    })
    expect(access.ready()).toBe(true)
    expect(access.get().enableReportCommand).toBe(false)   // 绑定即刷新，晚注册的 watcher 也拿到当前值
    push?.({ ...DAILY_LOG_CONFIG_BASE, enableReportCommand: true })
    expect(seen).toEqual([false, true])                     // 开关热切换是 Task 6 赖以生效的前提
  })

  it('取消订阅后不再收到通知', () => {
    const access = createDailyLogSettingsAccess()
    let push: ((next: DailyLogConfig) => void) | undefined
    let calls = 0
    const off = access.watch(() => { calls += 1 })
    access.bind({ get: () => ({ ...DAILY_LOG_CONFIG_BASE }), watch: (cb) => { push = cb; return () => {} } })
    off()
    push?.({ ...DAILY_LOG_CONFIG_BASE, enableReportCommand: false })
    expect(calls).toBe(1)
  })
})
