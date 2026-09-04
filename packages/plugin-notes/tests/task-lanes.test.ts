/**
 * core/task-lanes 纯函数单测：五列状态 ↔ 五色纸卡的双向映射（闭合、无缺口）、
 * 分列分组（五列恒在、顺序一致、空列为空数组）、列内保持传入顺序（排序
 * 职责归调用方的 partitionNotes/sortNotes）。
 */

import { describe, expect, it } from 'vitest'
import {
  TASK_LANES,
  colorForStatus,
  groupNotesByLane,
  statusForColor,
} from '../src/client/core/task-lanes.ts'
import type { TaskStatus } from '../src/client/core/task-lanes.ts'
import type { NoteColor, NoteId, NoteRecord } from '../src/types.ts'

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

describe('任务泳道：状态 ↔ 纸色映射', () => {
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

  it('每个状态映射回自己的纸色（colorForStatus 与 TASK_LANES 一致）', () => {
    for (const lane of TASK_LANES) {
      expect(colorForStatus(lane.status)).toBe(lane.color)
    }
  })

  it('每种泳道纸色恰好映射到一个状态，覆盖全部五列（紫色为自由色，不参与状态映射）', () => {
    const laneColors = TASK_LANES.map((lane) => lane.color)
    const covered = new Set<TaskStatus>(laneColors.map((color) => statusForColor(color)))
    expect(covered.size).toBe(TASK_LANES.length)
    expect(covered).toEqual(new Set(TASK_LANES.map((lane) => lane.status)))
  })

  it('statusForColor 与 colorForStatus 双向往返一致（仅泳道五色）', () => {
    for (const lane of TASK_LANES) {
      expect(colorForStatus(statusForColor(lane.color))).toBe(lane.color)
    }
  })

  it('便签默认黄（yellow）落在待办，与新建落「待办」列语义一致', () => {
    expect(statusForColor('yellow')).toBe('todo')
    expect(colorForStatus('todo')).toBe('yellow')
  })
})

describe('groupNotesByLane 分列', () => {
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

  it('按纸色分到对应列（灰→待规划、黄→待办、蓝→进行中、绿→已完成、粉→已失败）', () => {
    const notes = [
      note({ id: id('g'), color: 'gray' }),
      note({ id: id('y'), color: 'yellow' }),
      note({ id: id('b'), color: 'blue' }),
      note({ id: id('gn'), color: 'green' }),
      note({ id: id('p'), color: 'pink' }),
    ]
    const groups = groupNotesByLane(notes)
    const byStatus = new Map(groups.map((g) => [g.status, g.notes.map((n) => n.id)]))
    expect(byStatus.get('backlog')).toEqual([id('g')])
    expect(byStatus.get('todo')).toEqual([id('y')])
    expect(byStatus.get('running')).toEqual([id('b')])
    expect(byStatus.get('done')).toEqual([id('gn')])
    expect(byStatus.get('failed')).toEqual([id('p')])
  })

  it('每条便签恰好出现在一列（分列后总数守恒，不丢卡）', () => {
    const colors: readonly NoteColor[] = ['gray', 'yellow', 'blue', 'yellow', 'green', 'pink']
    const notes = colors.map((color, index) =>
      note({ id: id(`n${index}`), color }),
    )
    const groups = groupNotesByLane(notes)
    const flattened = groups.flatMap((g) => g.notes.map((n) => n.id))
    expect(flattened).toHaveLength(notes.length)
    expect(new Set(flattened)).toEqual(new Set(notes.map((n) => n.id)))
  })

  it('列内保持传入顺序（主排序由调用方完成，本函数不排序）', () => {
    const older = note({ id: id('a'), color: 'yellow', updatedAt: 2 })
    const newer = note({ id: id('b'), color: 'yellow', updatedAt: 9 })
    const groups = groupNotesByLane([older, newer])
    const todo = groups.find((g) => g.status === 'todo')
    expect(todo?.notes.map((n) => n.id)).toEqual([id('a'), id('b')])
  })
})
