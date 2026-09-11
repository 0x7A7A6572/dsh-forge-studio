/**
 * 分层渲染与下钻过滤（纯函数）：
 * 关键口径 —— 默认 index 的行数只与分组数有关（与消息条数无关）、折叠必须显式、summary 给首问+末答。
 */

import { describe, expect, it } from 'vitest'
import { filterEntries, renderScan } from '../src/agent/scan-render.ts'
import type { ActivityEntry } from '../src/types.ts'

let seq = 0
function entry(over: Partial<ActivityEntry> & { ts: number }): ActivityEntry {
  seq += 1
  return {
    sourceLabel: 'demo',
    channel: 'claude',
    kind: 'conversation',
    title: '[回答] 片段 ' + seq,
    body: '正文 ' + seq,
    ...over,
  }
}

describe('renderScan / index（默认）', () => {
  it('行数只与分组数有关：一个会话 300 条仍是 1 行', () => {
    const entries = Array.from({ length: 300 }, (_, i) =>
      entry({ ts: Date.parse('2026-09-08T00:00:00Z') + i * 1000, group: 's-1', groupTitle: '排查内存泄漏', role: i % 7 === 0 ? 'user' : 'assistant' }),
    )
    const out = renderScan(entries)
    const lines = out.split('\n')
    expect(lines).toHaveLength(3) // 块头 + 1 组 + 页脚
    expect(out).toContain('[claude] demo · 2026-09-08 · 300 条消息 · 1 组')
    expect(out).toContain('排查内存泄漏 · 2026-09-08 · 300 条（问 43 / 答 257）')
  })

  it('git（提交）单独成块并按分支分组', () => {
    const entries = [
      entry({ ts: Date.parse('2026-09-08T02:00:00Z'), channel: 'git', kind: 'commit', group: 'fix/x', groupTitle: 'fix/x', title: 'a' }),
      entry({ ts: Date.parse('2026-09-09T02:00:00Z'), channel: 'git', kind: 'commit', group: 'fix/x', groupTitle: 'fix/x', title: 'b' }),
    ]
    const out = renderScan(entries)
    expect(out).toContain('[git] demo · 2026-09-08~2026-09-09 · 2 提交 · 1 组')
    expect(out).toContain('· fix/x · 2026-09-08~2026-09-09 · 2 提交')
  })

  it('分组超上限时显式列出未展开的组（不静默丢弃）', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry({ ts: Date.parse('2026-09-08T00:00:00Z'), group: 's-' + i, groupTitle: '会话' + i }),
    )
    const out = renderScan(entries, { maxGroups: 3 })
    expect(out).toContain('… 未展开分组：claude/demo 9 组（会话3、会话4、会话5 等）')
    expect(out).toContain('共 12 条 · 12 组')
  })

  it('总行数超上限时给出行数说明', () => {
    const entries = Array.from({ length: 8 }, (_, i) =>
      entry({ ts: Date.parse('2026-09-08T00:00:00Z'), group: 's-' + i, groupTitle: '会话' + i }),
    )
    const out = renderScan(entries, { maxLines: 4 })
    expect(out).toContain('另有')
    expect(out.split('\n').length).toBeLessThanOrEqual(6)
  })

  it('空数据给出占位', () => {
    expect(renderScan([])).toBe('(no entries)')
  })

  it('弱标题兜底：会话 id / 空壳标题改用首条用户提问', () => {
    const byId = [
      entry({ ts: 1, group: 'agent-abe2c29643c8ed30e', groupTitle: 'agent-abe2c29643c8ed30e', role: 'user', body: '举报分类的树形渲染不对，二级数据对不上' }),
      entry({ ts: 2, group: 'agent-abe2c29643c8ed30e', groupTitle: 'agent-abe2c29643c8ed30e', role: 'assistant', body: '已定位到 buildTree' }),
    ]
    expect(renderScan(byId)).toContain('· 举报分类的树形渲染不对，二级数据对不上 ·')
    const shell = [entry({ ts: 1, group: 's-9', groupTitle: '11', role: 'user', body: '排查一下这个定时任务为什么没跑' })]
    expect(renderScan(shell)).toContain('· 排查一下这个定时任务为什么没跑 ·')
  })

  it('提交分组不受弱标题兜底影响（分支名 t1 保持原样）', () => {
    const commits = [entry({ ts: 1, channel: 'git', kind: 'commit', group: 't1', groupTitle: 't1', title: 'fix: 修复树形渲染' })]
    const out = renderScan(commits)
    expect(out).toContain('· t1 ·')
    expect(out).not.toContain('fix: 修复树形渲染 ·')
  })
})

describe('renderScan / summary', () => {
  it('补该组首问与末答（各截断）', () => {
    const entries = [
      entry({ ts: Date.parse('2026-09-08T01:00:00Z'), group: 's-1', groupTitle: '登录重构', role: 'user', body: '帮我把登录模块拆一下' }),
      entry({ ts: Date.parse('2026-09-08T02:00:00Z'), group: 's-1', groupTitle: '登录重构', role: 'assistant', body: '中间步骤' }),
      entry({ ts: Date.parse('2026-09-08T03:00:00Z'), group: 's-1', groupTitle: '登录重构', role: 'assistant', body: '已拆成 auth 与 session 两个 composable' }),
    ]
    const out = renderScan(entries, { level: 'summary' })
    expect(out).toContain('  ▸ 登录重构 · 2026-09-08 · 3 条（问 1 / 答 2）')
    expect(out).toContain('    问：帮我把登录模块拆一下')
    expect(out).toContain('    答：已拆成 auth 与 session 两个 composable') // 末答而非中间步骤
    expect(out).not.toContain('中间步骤')
  })
})

describe('renderScan / raw', () => {
  it('逐条明细按时间升序并显式截断', () => {
    const entries = [
      entry({ ts: Date.parse('2026-09-09T00:00:00Z'), title: '[回答] 后' }),
      entry({ ts: Date.parse('2026-09-08T00:00:00Z'), title: '[提问] 先' }),
    ]
    const out = renderScan(entries, { level: 'raw' })
    expect(out.split('\n')[0]).toContain('[提问] 先')
    const capped = renderScan(entries, { level: 'raw', maxLines: 1 })
    expect(capped).toContain('(truncated, 1 more)')
  })
})

describe('filterEntries（下钻）', () => {
  const entries = [
    entry({ ts: 1, group: 'session-aaa', groupTitle: '内存泄漏排查', body: '复现了 OOM' }),
    entry({ ts: 2, group: 'session-bbb', groupTitle: '登录重构', body: '拆模块' }),
  ]

  it('按会话 id / 标题包含匹配', () => {
    expect(filterEntries(entries, { sessionId: 'session-a' })).toHaveLength(1)
    expect(filterEntries(entries, { sessionId: '登录重构' })).toHaveLength(1)
    expect(filterEntries(entries, { sessionId: 'nope' })).toHaveLength(0)
  })

  it('关键词任一命中，空格/逗号分隔', () => {
    expect(filterEntries(entries, { keywords: 'OOM' })).toHaveLength(1)
    expect(filterEntries(entries, { keywords: 'oom，拆模块' })).toHaveLength(2)
  })

  it('不带条件时原样返回', () => {
    expect(filterEntries(entries, {})).toHaveLength(2)
    expect(filterEntries(entries)).toHaveLength(2)
  })
})
