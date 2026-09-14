/**
 * 定时执行调度器（host 侧）：周期 tick 扫描到期日程 → 调 service.taskExecuteScheduled 派发
 * （与用户点泳道卡「执行」**同一条链路**：按工作区新建会话 + 投递 + 租约），再把
 * 结果写回 schedule（lastFiredAt/lastResult/nextAt）。
 *
 * 为什么放 host：调度要「人不在也照跑」——跑在宿主进程里，与便签板/UI 是否打开无关，
 * 与 index.ts 里 WebDAV 的自动检查定时器同款装配方式（setInterval + ctx.effect 清理）。
 *
 * 语义要点（推导见 schedule.ts 头注释）：
 * - 到期 = enabled && !archived && 有 lane && nextAt <= now（纯函数 pickDueNotes）；
 * - 状态闸门（软）：lane.status 为 待规划/已完成/已失败 时不派发，只顺延并记原因；
 * - 错误边界：连续失败到 SCHEDULE_MAX_FAILURES 自动停用；定时发起的 run 超时未收尾
 *   由 host 兜底 settle（见 SCHEDULE_RUN_TIMEOUT_MS / isRunTimeout）；
 * - 不补历史：一次 tick 对一张便签最多派发一次，循环的 nextAt 永远从 now 之后重算；
 * - 单张便签出错只丢该张（记 warn），绝不中断整轮、更不拖垮 host；
 * - 上一轮 tick 未结束（派发慢）时本轮直接跳过，避免同一张便签被派发两次。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { NotesService } from './service.ts'
import {
  SCHEDULE_RUN_TIMEOUT_MS,
  applyScheduleDispatch,
  applyScheduleSkip,
  isNoteScheduleDue,
  isOnceStale,
  scheduleBlockReason,
  type ScheduleDispatchOutcome,
} from './schedule.ts'

// 再导出：超时常量的权威定义在 schedule.ts（共享纯语义），host 侧沿用本模块引用。
export { SCHEDULE_RUN_TIMEOUT_MS }
import type { NoteId, NoteRecord, NoteSchedule } from './types.ts'

/** tick 间隔（30s）：分钟级精度足够，且比 1s 轮询省得多。 */
export const SCHEDULE_TICK_MS = 30_000

/** 超时兜底写进 run.summary / 日程失败原因的中文说明。 */
export const RUN_TIMEOUT_SUMMARY = '超时未收尾'

/** 该便签的 run 是否已超时（只认定时发起的、尚未收尾的 run）。 */
export function isRunTimeout(note: NoteRecord, now: number): boolean {
  if (note.lane?.status !== 'running') return false
  const run = note.lane.run
  if (run === undefined || run.finishedAt !== undefined || run.by !== 'schedule') return false
  return now - run.startedAt >= SCHEDULE_RUN_TIMEOUT_MS
}

/** 一次性日程过期未派发时的收尾说明（宿主长期未运行）。 */
const STALE_RESULT = '已过期（宿主长期未运行），已停用'

/** 调度器依赖（注入以便单测：假 now / 假执行 / 假写回）。 */
export interface ScheduleRunnerDeps {
  /** 全量便签（同步读）。 */
  readonly list: () => readonly NoteRecord[]
  /** 派发一次任务执行（host 执行事务）。 */
  readonly execute: (
    id: NoteId,
  ) => Promise<
    | { readonly ok: true; readonly note: NoteRecord }
    | {
        readonly ok: false
        readonly reason: 'missing' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed'
      }
  >
  /** 写回日程（service.setSchedule；不触碰 lane/lease）。 */
  readonly write: (id: NoteId, schedule: NoteSchedule | undefined) => Promise<void>
  /** 超时兜底：把卡住的定时 run 交 service 收尾（失败 + 计失败连击 + 撤销租约）。 */
  readonly settle: (id: NoteId, summary: string) => Promise<void>
  /** 告警（日志；不抛出）。 */
  readonly warn: (message: string, error?: unknown) => void
}

export interface ScheduleRunner {
  /** 跑一轮：返回本轮成功派发的便签 id。 */
  run(now?: number): Promise<readonly NoteId[]>
}

/** 装配调度执行器（纯依赖注入，无定时器；定时器见 installNotesScheduler）。 */
export function createScheduleRunner(deps: ScheduleRunnerDeps): ScheduleRunner {
  /** 在途标记：tick 重入直接跳过（派发是异步的，30s 可能不够）。 */
  let running = false
  return {
    async run(now: number = Date.now()): Promise<readonly NoteId[]> {
      if (running) return []
      running = true
      const fired: NoteId[] = []
      try {
        for (const note of deps.list()) {
          try {
            // 超时兜底先跑：卡住的定时 run 由 host 收尾（否则这张便签会永久「进行中」）。
            if (isRunTimeout(note, now)) {
              await deps.settle(note.id, RUN_TIMEOUT_SUMMARY)
              continue
            }
            if (!isNoteScheduleDue(note, now)) continue
            const schedule = note.schedule
            if (schedule === undefined) continue
            // 一次性日程过期太久（宿主停了一周以上）：不补跑，直接停用并记原因。
            // 先于状态闸门——否则躺在「待规划」里的过期一次性日程永远不会被收掉。
            if (isOnceStale(schedule, now)) {
              await deps.write(note.id, { ...schedule, enabled: false, lastResult: STALE_RESULT })
              continue
            }
            // 状态闸门（软）：待规划 / 已完成 / 已失败不自动派发——只顺延并记下原因，
            // 日程保持 enabled，用户把卡片拖回「待办」即自动恢复。
            const blocked = scheduleBlockReason(note)
            if (blocked !== undefined) {
              const skipped = applyScheduleSkip(schedule, blocked, now)
              if (skipped !== undefined) await deps.write(note.id, skipped)
              continue
            }
            const result = await deps.execute(note.id)
            if (result.ok) {
              await deps.write(note.id, applyScheduleDispatch(schedule, 'dispatched', now))
              fired.push(note.id)
              continue
            }
            // 便签已被删：无对象可写回，静默跳过。
            if (result.reason === 'missing') continue
            const outcome: ScheduleDispatchOutcome = result.reason
            await deps.write(note.id, applyScheduleDispatch(schedule, outcome, now))
          } catch (error) {
            // 单张便签出错（写回失败等）只丢该张：不让一张坏日程卡住整轮派发。
            deps.warn(`[plugin-notes] schedule tick failed for note ${note.id}:`, error)
          }
        }
      } finally {
        running = false
      }
      return fired
    },
  }
}

/**
 * 在 host 装配调度定时器（index.ts 调用）：每 SCHEDULE_TICK_MS 跑一轮，卸载即清理。
 * tick 内的任何抛错都在 runner 里被收住（记 warn），不会冒泡成未捕获异常。
 */
export function installNotesScheduler(ctx: Context, notes: NotesService): ScheduleRunner {
  const runner = createScheduleRunner({
    list: () => notes.list(),
    // 调度器走 taskExecuteScheduled：同一条事务，但 run 帧带 by='schedule'，
    // 与用户手点「执行」在超时兜底/审计上区分开。
    execute: (id) => notes.taskExecuteScheduled(id),
    write: async (id, schedule) => {
      await notes.setSchedule(id, schedule)
    },
    settle: async (id, summary) => {
      await notes.settleTaskRun(id, false, summary)
    },
    warn: (message, error) => ctx.logger.warn(message, error),
  })
  const timer = setInterval(() => {
    void runner.run()
  }, SCHEDULE_TICK_MS)
  ctx.effect(() => () => { clearInterval(timer) })
  return runner
}
