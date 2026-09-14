/**
 * core/task-lanes 纯函数单测：五列按 `note.lane.status` 分列（只含带 lane 的
 * 任务便签，无 lane 的普通便签不进任何列）、laneLabel 标签映射、makeLane/
 * beginRun/settleRun/isRunOpen 纯函数。颜色不再参与状态映射（旧 colorForStatus/
 * statusForColor 已删除）；列定义不再携带 color。
 */

import { describe, expect, it } from 'vitest'
import {
  TASK_LANES,
  beginRun,
  groupNotesByLane,
  isRunOpen,
  countOpenTasks,
  laneLabel,
  lanePatchForSave,
  makeLane,
  settleRun,
} from '../src/client/core/task-lanes.ts'
import type { TaskStatus } from '../src/client/core/task-lanes.ts'
import type { NoteId, NoteLane, NoteRecord } from '../src/types.ts'

function note(partial: Partial<NoteRecord> & { id: string }): NoteRecord {
  return {
    title: 't',
    text: 'b',
    pinned: false,
    archived: false,
    color: 'yellow',
    origin: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

const id = (n: string) => n as NoteId

describe('任务泳道：列定义与标签', () => {
  it('五列顺序与 dsh-task-board 一致：待规划→待办→进行中→已完成→已失败', () => {
    expect(TASK_LANES.map((lane) => lane.status)).toEqual([
      'backlog',
      'todo',
      'running',
      'done',
      'failed',
    ])
    expect(TASK_LANES.map((lane) => lane.label)).toEqual([
      '待规划',
      '待办',
      '进行中',
      '已完成',
      '已失败',
    ])
  })

  it('列定义不再携带 color（颜色与状态解耦）', () => {
    for (const lane of TASK_LANES) {
      expect('color' in lane).toBe(false)
    }
  })

  it('laneLabel 每个状态映射回自己的中文标签', () => {
    for (const lane of TASK_LANES) {
      expect(laneLabel(lane.status)).toBe(lane.label)
    }
  })
})

describe('groupNotesByLane 分列（按 lane.status）', () => {
  it('空输入也恒输出五列，每列 notes 为空数组', () => {
    const groups = groupNotesByLane([])
    expect(groups.map((g) => g.status)).toEqual([
      'backlog',
      'todo',
      'running',
      'done',
      'failed',
    ])
    expect(groups.every((g) => g.notes.length === 0)).toBe(true)
  })

  it('按 lane.status 分到对应列', () => {
    const notes = [
      note({ id: id('b'), lane: { status: 'backlog' } }),
      note({ id: id('t'), lane: { status: 'todo' } }),
      note({ id: id('r'), lane: { status: 'running' } }),
      note({ id: id('d'), lane: { status: 'done' } }),
      note({ id: id('f'), lane: { status: 'failed' } }),
    ]
    const groups = groupNotesByLane(notes)
    const byStatus = new Map(groups.map((g) => [g.status, g.notes.map((n) => n.id)]))
    expect(byStatus.get('backlog')).toEqual([id('b')])
    expect(byStatus.get('todo')).toEqual([id('t')])
    expect(byStatus.get('running')).toEqual([id('r')])
    expect(byStatus.get('done')).toEqual([id('d')])
    expect(byStatus.get('failed')).toEqual([id('f')])
  })

  it('无 lane 的普通便签不进任何列', () => {
    const notes = [
      note({ id: id('plain1'), color: 'purple' }),
      note({ id: id('plain2'), color: 'gray' }),
      note({ id: id('task'), lane: { status: 'todo' } }),
    ]
    const groups = groupNotesByLane(notes)
    const flattened = groups.flatMap((g) => g.notes.map((n) => n.id))
    expect(flattened).toEqual([id('task')])
    expect(flattened).not.toContain(id('plain1'))
    expect(flattened).not.toContain(id('plain2'))
  })

  it('每条任务便签恰好出现在一列（分列后总数守恒，不丢卡）', () => {
    const statuses: readonly TaskStatus[] = ['backlog', 'todo', 'running', 'todo', 'done', 'failed']
    const notes = statuses.map((status, index) =>
      note({ id: id(`n${index}`), lane: { status } }),
    )
    const groups = groupNotesByLane(notes)
    const flattened = groups.flatMap((g) => g.notes.map((n) => n.id))
    expect(flattened).toHaveLength(notes.length)
    expect(new Set(flattened)).toEqual(new Set(notes.map((n) => n.id)))
  })

  it('列内保持传入顺序（主排序由调用方完成，本函数不排序）', () => {
    const older = note({ id: id('a'), lane: { status: 'todo' }, updatedAt: 2 })
    const newer = note({ id: id('b'), lane: { status: 'todo' }, updatedAt: 9 })
    const groups = groupNotesByLane([older, newer])
    const todo = groups.find((g) => g.status === 'todo')
    expect(todo?.notes.map((n) => n.id)).toEqual([id('a'), id('b')])
  })
})

describe('makeLane / beginRun / settleRun / isRunOpen', () => {
  it('makeLane 只含 status，不含 run', () => {
    expect(makeLane('todo')).toEqual({ status: 'todo' })
  })

  it('beginRun 置 running 并开新 run 帧（默认发起方 = user，可显式传 schedule）', () => {
    expect(beginRun({ status: 'todo' }, 42)).toEqual({
      status: 'running',
      run: { startedAt: 42, by: 'user' },
    })
    expect(beginRun({ status: 'todo' }, 42, 'schedule')).toEqual({
      status: 'running',
      run: { startedAt: 42, by: 'schedule' },
    })
  })

  it('settleRun 在已有 run 上补 finishedAt/ok/summary，保留 startedAt 与 status', () => {
    const lane: NoteLane = { status: 'running', run: { startedAt: 1 } }
    expect(settleRun(lane, true, '完成', 9)).toEqual({
      status: 'running',
      run: { startedAt: 1, finishedAt: 9, ok: true, summary: '完成' },
    })
  })

  it('settleRun 在无 run 时先按 startedAt=at 造帧（不炸）', () => {
    expect(settleRun({ status: 'todo' }, false, '失败', 9)).toEqual({
      status: 'todo',
      run: { startedAt: 9, finishedAt: 9, ok: false, summary: '失败' },
    })
  })

  it('isRunOpen：有 run 且 finishedAt 未落 = true；无 run / 已落 = false', () => {
    expect(isRunOpen({ status: 'running', run: { startedAt: 1 } })).toBe(true)
    expect(isRunOpen({ status: 'todo' })).toBe(false)
    expect(isRunOpen({ status: 'done', run: { startedAt: 1, finishedAt: 9, ok: true } })).toBe(false)
  })
})

describe('lanePatchForSave（编辑器「设为任务」开关 → lane patch）', () => {
  it('开关开且状态未改 → undefined（防陈旧快照回滚宿主 settle 态）', () => {
    // running 对话框打开期间宿主已 settle 成 done/failed：仅存正文时不得再发
    // { status: 'running' }，否则会把宿主最新状态静默回滚。
    expect(lanePatchForSave(true, 'running', { status: 'running' })).toBeUndefined()
  })

  it('开关开且状态已改 → { status }（手动改状态，宿主撤销租约）', () => {
    expect(lanePatchForSave(true, 'done', { status: 'todo' })).toEqual({ status: 'done' })
  })

  it('开关开且原本非任务（普通便签转任务）→ { status }', () => {
    expect(lanePatchForSave(true, 'todo', undefined)).toEqual({ status: 'todo' })
  })

  it('开关关且原本是任务 → { clear: true }（取消任务）', () => {
    expect(lanePatchForSave(false, 'todo', { status: 'todo' })).toEqual({ clear: true })
  })

  it('开关关且原本非任务 → undefined（纯内容更新，不改 lane）', () => {
    expect(lanePatchForSave(false, 'todo', undefined)).toBeUndefined()
  })
})

describe('countOpenTasks（侧栏「活动待办」徽标口径）', () => {
  it('空输入 → 0', () => {
    expect(countOpenTasks([])).toBe(0)
  })

  it('只计 待办/进行中；待规划/已完成/已失败不计', () => {
    const notes = [
      note({ id: id('backlog'), lane: { status: 'backlog' } }),
      note({ id: id('todo'), lane: { status: 'todo' } }),
      note({ id: id('running'), lane: { status: 'running' } }),
      note({ id: id('done'), lane: { status: 'done' } }),
      note({ id: id('failed'), lane: { status: 'failed' } }),
    ]
    expect(countOpenTasks(notes)).toBe(2)
  })

  it('无 lane 的普通便签不计', () => {
    const notes = [
      note({ id: id('plain'), color: 'purple' }),
      note({ id: id('todo'), lane: { status: 'todo' } }),
    ]
    expect(countOpenTasks(notes)).toBe(1)
  })

  it('归档不计（即使泳道状态是待办/进行中）', () => {
    const notes = [
      note({ id: id('archivedTodo'), archived: true, lane: { status: 'todo' } }),
      note({ id: id('archivedRunning'), archived: true, lane: { status: 'running' } }),
      note({ id: id('live'), lane: { status: 'todo' } }),
    ]
    expect(countOpenTasks(notes)).toBe(1)
  })

  it('置顶与手写/agent 来源都计（计数只看状态与归档）', () => {
    const notes = [
      note({ id: id('pinned'), pinned: true, lane: { status: 'running' } }),
      note({ id: id('agent'), origin: 'agent', lane: { status: 'todo' } }),
    ]
    expect(countOpenTasks(notes)).toBe(2)
  })
})