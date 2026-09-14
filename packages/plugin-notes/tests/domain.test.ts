/**
 * 存储 schema 兼容性测试：旧记录（无 color 字段）打开不失败并回填默认色；
 * 合法 color 透传（含回归的紫色）；非法 color 被拒绝。这是 domain 打开不炸
 * 老数据的防线。
 */

import { describe, expect, it } from 'vitest'
import { noteRecordSchema, notesDomain, taskLeaseSchema } from '../src/domain.ts'
import type { NoteId } from '../src/types.ts'

const LEGACY = {
  id: 'legacy-1' as NoteId,
  title: '老便签',
  text: '旧数据没有 color 字段',
  pinned: false,
  createdAt: 1,
  updatedAt: 2,
}

describe('noteRecordSchema 兼容旧数据', () => {
  it('缺 color 的旧记录可解析并回填默认黄', () => {
    const parsed = noteRecordSchema.parse(LEGACY)
    expect(parsed.color).toBe('yellow')
  })

  it('缺 archived 的旧记录可解析并回填 false', () => {
    const parsed = noteRecordSchema.parse(LEGACY)
    expect(parsed.archived).toBe(false)
  })

  it('合法 color 原样透传', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, color: 'pink' })
    expect(parsed.color).toBe('pink')
  })

  it('archived 原样透传', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, archived: true })
    expect(parsed.archived).toBe(true)
  })

  it('非法 archived 类型被拒绝', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, archived: 'yes' })).toThrow()
  })

  it('非法 color 值被拒绝', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, color: 'neon' })).toThrow()
  })

  it('紫色回归为合法纸色，读取时原样透传', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, color: 'purple' })
    expect(parsed.color).toBe('purple')
  })
})

describe('noteRecordSchema lane 校验', () => {
  it('无 lane 的旧记录解析后 lane 为 undefined', () => {
    const parsed = noteRecordSchema.parse(LEGACY)
    expect(parsed.lane).toBeUndefined()
  })

  it('合法 lane（status + 完整 run）原样透传', () => {
    const lane = { status: 'running', run: { startedAt: 1, finishedAt: 2, ok: true, summary: 'ok' } }
    const parsed = noteRecordSchema.parse({ ...LEGACY, lane })
    expect(parsed.lane).toEqual(lane)
  })

  it('lane 仅 status（无 run）可解析', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, lane: { status: 'backlog' } })
    expect(parsed.lane).toEqual({ status: 'backlog' })
  })

  it('run 缺省字段（仅 startedAt）可解析', () => {
    const parsed = noteRecordSchema.parse({ ...LEGACY, lane: { status: 'done', run: { startedAt: 1 } } })
    expect(parsed.lane?.run).toEqual({ startedAt: 1 })
  })

  it('非法 lane.status 被拒绝', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, lane: { status: 'nope' } })).toThrow()
  })

  it('非法 run.startedAt 类型被拒绝', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, lane: { status: 'running', run: { startedAt: 'x' } } })).toThrow()
  })
})

describe('taskLeaseSchema 校验', () => {
  it('合法租约记录原样透传', () => {
    const lease = { noteId: 'n1', sessionId: 's1', grantedAt: 1 }
    expect(taskLeaseSchema.parse(lease)).toEqual(lease)
  })

  it('缺 sessionId 被拒绝', () => {
    expect(() => taskLeaseSchema.parse({ noteId: 'n1', grantedAt: 1 })).toThrow()
  })

  it('非法 grantedAt 类型被拒绝', () => {
    expect(() => taskLeaseSchema.parse({ noteId: 'n1', sessionId: 's1', grantedAt: 'x' })).toThrow()
  })
})

describe('notesDomain leases 表', () => {
  it('域声明同时含 notes 与 leases 两张表', () => {
    expect(Object.keys(notesDomain.tables)).toEqual(['notes', 'leases'])
  })

  it('leases 表 schema 能校验租约记录', () => {
    const parsed = notesDomain.tables.leases.valueSchema.parse({ noteId: 'n1', sessionId: 's1', grantedAt: 1 })
    expect(parsed).toEqual({ noteId: 'n1', sessionId: 's1', grantedAt: 1 })
  })
})

describe('noteRecordSchema schedule 校验', () => {
  it('无 schedule 的旧记录解析后为 undefined（不回填、不炸库）', () => {
    expect(noteRecordSchema.parse(LEGACY).schedule).toBeUndefined();
  })

  it('合法日程（含 lastFiredAt/lastResult）原样透传', () => {
    const schedule = { enabled: true, mode: 'daily', time: '09:00', nextAt: 100, lastFiredAt: 50, lastResult: '已派发' };
    expect(noteRecordSchema.parse({ ...LEGACY, schedule }).schedule).toEqual(schedule);
  })

  it('五种模式都可解析', () => {
    const modes = [
      { enabled: true, mode: 'once', at: 1, nextAt: 1 },
      { enabled: true, mode: 'interval', everyMin: 30, nextAt: 1 },
      { enabled: true, mode: 'daily', time: '09:00', nextAt: 1 },
      { enabled: true, mode: 'weekly', time: '09:00', weekdays: [1, 3], nextAt: 1 },
      { enabled: true, mode: 'monthly', time: '09:00', monthDay: 1, nextAt: 1 },
    ];
    for (const schedule of modes) {
      expect(noteRecordSchema.parse({ ...LEGACY, schedule }).schedule).toEqual(schedule);
    }
  })

  it('非法 mode 被拒绝', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, schedule: { enabled: true, mode: 'cron', nextAt: 1 } })).toThrow();
  })

  it('缺 nextAt 被拒绝（nextAt 是 host 计算的权威字段，必填）', () => {
    expect(() => noteRecordSchema.parse({ ...LEGACY, schedule: { enabled: true, mode: 'daily', time: '09:00' } })).toThrow();
  })
})
