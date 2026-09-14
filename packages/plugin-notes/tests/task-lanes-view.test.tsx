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

/** 任务身份：泳道卡只渲染带 lane 的便签。 */
const TODO_LANE = { status: 'todo' } as const

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
      onExecute={noop}
      onReset={noop}
      onCreateTask={noop}
    />,
  )
}

describe('TaskLanes 泳道卡工作区展示（执行目录）', () => {
  it('显式工作区显示末段目录名，完整路径进 title（Windows 反斜杠路径）', () => {
    const html = renderLanes([note({ id: id('w1'), lane: TODO_LANE, workspace: 'D:\\codes\\my-app' })])
    expect(html).toContain('工作区：D:\\codes\\my-app')
    expect(html).toContain('my-app')
  })

  it('正斜杠路径与尾随分隔符同样取末段目录名', () => {
    const html = renderLanes([note({ id: id('w2'), lane: TODO_LANE, workspace: 'D:/codes/other-app/' })])
    expect(html).toContain('工作区：D:/codes/other-app/')
    expect(html).toContain('other-app')
  })

  it('未指定工作区（缺省 = 执行时用设置默认值）不渲染工作区行', () => {
    const html = renderLanes([note({ id: id('w3'), lane: TODO_LANE })])
    expect(html).not.toContain('工作区：')
  })
})

describe('TaskLanes 泳道卡定时展示', () => {
  it('有日程：显示「周期 · 下次时刻」，title 带完整说明与上次结果', () => {
    const next = new Date(2026, 0, 6, 9, 0, 0, 0).getTime();
    const html = renderLanes([
      note({
        id: id('s1'),
        lane: TODO_LANE,
        schedule: { enabled: true, mode: 'daily', time: '09:00', nextAt: next, lastResult: '已派发' },
      }),
    ]);
    expect(html).toContain('定时：每天 09:00');
    expect(html).toContain('下次 2026-01-06 09:00');
    expect(html).toContain('上次 已派发');
  })

  it('停用的日程不误导为「会跑」：显示定时已停用', () => {
    const html = renderLanes([
      note({ id: id('s2'), lane: TODO_LANE, schedule: { enabled: false, mode: 'interval', everyMin: 30, nextAt: 0 } }),
    ]);
    expect(html).toContain('定时已停用');
  })

  it('无日程的便签不渲染定时行', () => {
    const html = renderLanes([note({ id: id('s3'), lane: TODO_LANE })]);
    expect(html).not.toContain('定时');
  })
})

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

  it('running 卡有重置入口（重置为待办）且带 running 视觉', () => {
    const notes = [
      note({ id: id('r'), lane: { status: 'running', run: { startedAt: Date.now() - 60_000 } }, title: '进行中任务' }),
    ]
    const html = renderLanes(notes)
    // running 卡：重置入口 + running 边框类。
    expect(html).toContain('重置为待办')
    expect(html).toContain('fs-lane-running')
    // 执行主入口对 running 卡不出现（改为重置）。
    expect(html.match(/aria-label="执行"/g) ?? []).toHaveLength(0)
  })

  it('done 卡显示 run.summary 首行摘要', () => {
    const notes = [
      note({ id: id('d'), lane: { status: 'done', run: { startedAt: 1, finishedAt: 9, ok: true, summary: 'AI 已完成：生成报告' } }, title: '完成任务' }),
    ]
    const html = renderLanes(notes)
    expect(html).toContain('AI 已完成：生成报告')
    // done 卡主入口为「重跑」。
    expect(html).toContain('重跑')
  })

  it('failed 卡显示 run.summary 摘要且主入口为重跑', () => {
    const notes = [
      note({ id: id('f'), lane: { status: 'failed', run: { startedAt: 1, finishedAt: 9, ok: false, summary: '执行失败：超时' } }, title: '失败任务' }),
    ]
    const html = renderLanes(notes)
    expect(html).toContain('执行失败：超时')
    expect(html).toContain('重跑')
  })

  it('每列 header 有「＋新建任务」按钮（aria-label 带列标签）', () => {
    const html = renderLanes([])
    for (const label of LANE_LABELS) {
      expect(html).toContain(`在「${label}」列新建任务`)
    }
  })
})
