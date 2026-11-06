/**
 * 成员详情卡「成员会话」行的门禁：行映射纯逻辑 + catalog 行为不回归。
 *
 * 背景（实测故障）：成员卡此前只读 projectionsBySession[memberId].values.subagentCatalog
 * —— 那是成员自己 spawn 的子会话目录，普通成员永远为空，卡片永远显示
 * 「还没有子智能体会话」。官方工坊的语义是每个成员本身就是 lead 会话的 continuable
 * 子会话，「打开成员会话」= openSession({ parentSessionId: leadId, childSessionId:
 * member.id, mode: 'continuable' })。这里钉住 detail-model 新增的固定行映射，
 * 并顺带钉住 catalog 行的 openable / label 回退不被改坏。
 */
import { describe, expect, it } from 'vitest'
import {
  mapCatalogRows,
  memberSessionRowOf,
} from '../packages/plugin-agent-studio/src/client/core/pixel/detail-model.ts'

describe('memberSessionRowOf —— 成员卡的固定「成员会话」行', () => {
  it('成员行：target = { leadId, memberId, continuable }，openable', () => {
    const row = memberSessionRowOf({
      memberId: 'member-1',
      memberName: 'reviewer',
      isLead: false,
      leadId: 'lead-1',
    })
    expect(row.id).toBe('member-1')
    expect(row.mode).toBe('continuable')
    expect(row.openable).toBe(true)
    expect(row.target).toEqual({ parentSessionId: 'lead-1', childSessionId: 'member-1', mode: 'continuable' })
  })

  it('lead 行：走官方单参路由（同值对象会被宿主拒成 history error）', () => {
    const row = memberSessionRowOf({
      memberId: 'lead-1',
      memberName: 'lead',
      isLead: true,
      leadId: 'lead-1',
    })
    expect(row.target).toBe('lead-1')
  })

  it('label 优先取会话 title，取不到回退成员名', () => {
    const withTitle = memberSessionRowOf({
      memberId: 'member-1',
      memberName: 'reviewer',
      isLead: false,
      leadId: 'lead-1',
      title: '修复成员卡',
    })
    const withoutTitle = memberSessionRowOf({
      memberId: 'member-1',
      memberName: 'reviewer',
      isLead: false,
      leadId: 'lead-1',
    })
    expect(withTitle.label).toBe('修复成员卡')
    expect(withoutTitle.label).toBe('reviewer')
  })

  it('running 为 true 时行态是「正在运行」，否则「当前未运行」', () => {
    const running = memberSessionRowOf({
      memberId: 'member-1',
      memberName: 'reviewer',
      isLead: false,
      leadId: 'lead-1',
      running: true,
    })
    const idle = memberSessionRowOf({
      memberId: 'member-1',
      memberName: 'reviewer',
      isLead: false,
      leadId: 'lead-1',
    })
    expect(running.activity).toBe('running')
    expect(running.activityText).toBe('正在运行')
    expect(idle.activity).toBe('inactive')
    expect(idle.activityText).toBe('当前未运行')
  })
})

describe('mapCatalogRows —— catalog 行为不回归（子会话目录仍是次要区块）', () => {
  const now = 1_000

  it('external 不可打开，continuable 可打开；label 回退 catalog label → title → id', () => {
    const view = mapCatalogRows({
      entries: [
        { id: 'child-1', mode: 'continuable', label: '目录名' },
        { id: 'child-2', mode: 'external' },
      ],
      state: 'ready',
      summaries: { 'child-1': { title: '会话标题' } },
      now,
    })
    expect(view.phase).toBe('ready')
    expect(view.rows.map((row) => [row.id, row.label, row.openable])).toEqual([
      ['child-1', '目录名', true],
      ['child-2', 'child-2', false],
    ])
  })

  it('空目录 = ready 空行（空态文案由视图层决定，行映射不掺和）', () => {
    const view = mapCatalogRows({ entries: [], state: 'ready', now })
    expect(view.phase).toBe('ready')
    expect(view.rows).toEqual([])
    expect(view.running).toBe(false)
  })
})
