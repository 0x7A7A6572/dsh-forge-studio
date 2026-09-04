/**
 * TaskLanes（任务泳道视图）渲染级测试：五列恒在且顺序一致、带 lane 的便签按
 * lane.status 落位到对应列（标题出现在该列区块内）、空列显示占位、无 lane 的
 * 普通便签不渲染进任何列。用 react-dom/server 做静态渲染断言结构（无 DOM、
 * 不触发拖拽交互；映射/分组逻辑见 task-lanes.test.ts，交互写 lane 链路由
 * service/remote 既有测试覆盖）。
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TaskLanes } from '../src/client/components/task-lanes.tsx'
import type { NoteId, NoteRecord } from '../src/types.ts'

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
const noop = (): void => undefined

const LANE_LABELS = ['待规划', '待办', '进行中', '已完成', '已失败']

function renderLanes(notes: readonly NoteRecord[]): string {
  return renderToStaticMarkup(
    <TaskLanes
      notes={notes}
      busy={false}
      onEdit={noop}
      onTogglePin={noop}
      onToggleArchive={noop}
      onRemove={noop}
      onMove={noop}
    />,
  )
}

describe('TaskLanes 泳道视图渲染', () => {
  it('五列按 待规划→待办→进行中→已完成→已失败 顺序渲染，空列有占位', () => {
    const html = renderLanes([])
    let last = -1
    for (const label of LANE_LABELS) {
      const at = html.indexOf(label)
      expect(at).toBeGreaterThan(last)
      last = at
    }
    expect(html.match(/此列暂无便签/g)).toHaveLength(LANE_LABELS.length)
  })

  it('带 lane 的便签按 lane.status 落位到对应列区块内', () => {
    const notes: readonly NoteRecord[] = [
      note({ id: id('g'), lane: { status: 'backlog' }, title: '规划任务A' }),
      note({ id: id('y'), lane: { status: 'todo' }, title: '待办任务B' }),
      note({ id: id('b'), lane: { status: 'running' }, title: '进行中任务C' }),
      note({ id: id('gn'), lane: { status: 'done' }, title: '完成任务D' }),
      note({ id: id('p'), lane: { status: 'failed' }, title: '失败任务E' }),
      note({ id: id('y2'), lane: { status: 'todo' }, title: '待办任务F' }),
    ]
    const html = renderLanes(notes)
    // 每个标题必须落在它所属列标签之后、下一列标签之前（最后一列到文档末尾）。
    const placed = { backlog: '规划任务A', todo: '待办任务B', running: '进行中任务C', done: '完成任务D', failed: '失败任务E' }
    for (let index = 0; index < LANE_LABELS.length; index += 1) {
      const laneStart = html.indexOf(LANE_LABELS[index]!)
      const laneEnd =
        index + 1 < LANE_LABELS.length ? html.indexOf(LANE_LABELS[index + 1]!) : html.length
      const section = html.slice(laneStart, laneEnd)
      const expectedTitles = [placed[Object.keys(placed)[index] as keyof typeof placed]]
      // 待办列含两张便签（默认场景覆盖「一列多卡」）。
      if (index === 1) expectedTitles.push('待办任务F')
      for (const title of expectedTitles) {
        expect(section).toContain(title)
      }
    }
    // 全部任务便签标题都渲染出来（不丢卡）。
    for (const title of ['规划任务A', '待办任务B', '待办任务F', '进行中任务C', '完成任务D', '失败任务E']) {
      expect(html).toContain(title)
    }
  })

  it('无 lane 的普通便签不渲染进任何列', () => {
    const notes: readonly NoteRecord[] = [
      note({ id: id('plain'), color: 'purple', title: '普通便签X' }),
      note({ id: id('task'), lane: { status: 'todo' }, title: '待办任务B' }),
    ]
    const html = renderLanes(notes)
    expect(html).toContain('待办任务B')
    expect(html).not.toContain('普通便签X')
  })

  it('便签卡片只渲染一次（无跨列重复渲染）', () => {
    const notes = [
      note({ id: id('y1'), lane: { status: 'todo' }, title: '阿尔法待办' }),
      note({ id: id('y2'), lane: { status: 'todo' }, title: '贝塔待办' }),
    ]
    const html = renderLanes(notes)
    // 卡片 aria-label 即未置顶便签的标题，按 label 精确计数。
    expect(html.match(/aria-label="阿尔法待办"/g)).toHaveLength(1)
    expect(html.match(/aria-label="贝塔待办"/g)).toHaveLength(1)
  })

  it('列标题与数量汇总在静态标记中可见', () => {
    const notes = [note({ id: id('y'), lane: { status: 'todo' }, title: '待办X' })]
    const html = renderLanes(notes)
    // 待办列计数 1（aria-label：待办（1 张便签））。
    expect(html).toContain('待办（1 张便签）')
    // 其余列计数 0。
    for (const label of ['待规划（0 张便签）', '进行中（0 张便签）', '已完成（0 张便签）', '已失败（0 张便签）']) {
      expect(html).toContain(label)
    }
  })
})
