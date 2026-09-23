/**
 * 「现在」指针的时钟：规则时区的当日分钟，每分钟自己往前走。
 *
 * 它是**展示用**的时钟，不是判档依据 —— 档位由宿主下发（或由 core/tier-curve.ts 按窗口判）。
 */
import { useEffect, useState } from 'react'

const DAY_MS = 86_400_000

/** 规则时区的当日分钟（0..1439）。 */
export function ruleMinuteOfDay(now: number, utcOffsetMinutes: number): number {
  const shifted = now + utcOffsetMinutes * 60_000
  return Math.floor((((shifted % DAY_MS) + DAY_MS) % DAY_MS) / 60_000)
}

/**
 * 每分钟（对齐分钟边界）重算一次当日分钟。
 *
 * 为什么是递归 setTimeout 而不是 setInterval(60_000)：后者从**上一次回调**起算，定时器与
 * 渲染的抖动会一路累积，几小时后指针就跟真实时间差出几十秒；对齐到分钟边界再触发，
 * 指针永远落在整分钟上（+20ms 余量避开边界上的精度误差）。
 */
export function useRuleMinute(utcOffsetMinutes: number): number {
  const [minute, setMinute] = useState(() => ruleMinuteOfDay(Date.now(), utcOffsetMinutes))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      timer = setTimeout(() => {
        setMinute(ruleMinuteOfDay(Date.now(), utcOffsetMinutes))
        schedule()
      }, 60_000 - (Date.now() % 60_000) + 20)
    }
    // 偏移变了也要立刻按新偏移重算一次（挂载首帧就用的是它，不是初始 state 的旧值）。
    setMinute(ruleMinuteOfDay(Date.now(), utcOffsetMinutes))
    schedule()
    return () => { if (timer !== undefined) clearTimeout(timer) }
  }, [utcOffsetMinutes])
  return minute
}
