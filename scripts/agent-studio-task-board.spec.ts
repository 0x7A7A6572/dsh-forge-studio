import { describe, expect, it } from 'vitest'
import {
  SHARED_TASK_STATUS_TEXT,
  mapSharedTaskRows,
  sharedTaskDotOf,
  type StudioSharedTaskProjection,
} from '../packages/plugin-agent-studio/src/client/core/pixel/task-model.ts'

function task(
  overrides: Partial<StudioSharedTaskProjection> & { id: string },
): StudioSharedTaskProjection {
  return {
    subject: `subject-${overrides.id}`,
    status: 'pending',
    ready: true,
    writeScopes: [],
    ...overrides,
  }
}

// 模拟 lead 会话 agentTeam.tasks：reviewer 有两条、implementer 一条、一条未分配。
const tasks: readonly StudioSharedTaskProjection[] = [
  task({
    id: 't1',
    subject: '实现入口迁移',
    status: 'in_progress',
    ownerName: 'implementer',
    writeScopes: ['packages/plugin-agent-studio'],
  }),
  task({ id: 't2', subject: '审查详情卡', status: 'pending', ownerName: 'reviewer', ready: false }),
  task({ id: 't3', subject: '补回归用例', status: 'completed', ownerName: 'reviewer' }),
  task({ id: 't4', subject: '未分配任务', status: 'deleted' }),
]

describe('agent studio shared task board', () => {
  it('lead sees every task with its owner, a member only sees its own', () => {
    const lead = mapSharedTaskRows({ tasks, showAll: true })
    expect(lead.map((row) => row.taskId)).toEqual(['t1', 't2', 't3', 't4'])
    expect(lead[0].ownerName).toBe('implementer')
    expect(lead[3].ownerName).toBeUndefined()

    const reviewer = mapSharedTaskRows({ tasks, ownerName: 'reviewer' })
    expect(reviewer.map((row) => row.taskId)).toEqual(['t2', 't3'])
    expect(reviewer.every((row) => row.ownerName === undefined)).toBe(true)
    expect(mapSharedTaskRows({ tasks, ownerName: 'architect' })).toEqual([])
  })

  it('keeps task rows separate from subagent catalog rows', () => {
    const rows = mapSharedTaskRows({ tasks, showAll: true })
    expect(Object.keys(rows[0]).sort()).toEqual([
      'dot',
      'ownerName',
      'status',
      'statusText',
      'subject',
      'taskId',
      'writeScopes',
    ])
    expect('activity' in rows[0]).toBe(false)
    expect('openable' in rows[0]).toBe(false)
  })

  it('maps task status to text and StateDot semantics', () => {
    expect(sharedTaskDotOf('in_progress')).toBe('ongoing')
    expect(sharedTaskDotOf('completed')).toBe('done')
    expect(sharedTaskDotOf('pending', true)).toBe('idle')
    expect(sharedTaskDotOf('pending', false)).toBe('warning')
    expect(sharedTaskDotOf('deleted')).toBe('idle')
    expect(SHARED_TASK_STATUS_TEXT).toEqual({
      pending: '待处理',
      in_progress: '进行中',
      completed: '已完成',
      deleted: '已删除',
    })
  })
})
