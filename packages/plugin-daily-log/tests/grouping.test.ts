/**
 * 分组键的采集：git 分支、Claude ai-title、DSH session/title、共享解析器的会话透传。
 */

import { describe, expect, it } from 'vitest'
import { primaryBranch } from '../src/sources/git.ts'
import { extractAiTitle } from '../src/sources/claude.ts'
import { extractSessionTitle } from '../src/sources/dsh.ts'
import { parseConversationLine } from '../src/sources/conversation-jsonl.ts'

const range = { since: '2026-09-01', until: '2026-10-01' }

describe('git 主分支名', () => {
  it('取 HEAD 指向的分支并去掉 origin/ 前缀', () => {
    expect(primaryBranch('HEAD -> feature/335_s103_linke-dispatch, origin/feature/335_s103_linke-dispatch')).toBe('feature/335_s103_linke-dispatch')
    expect(primaryBranch('origin/HEAD -> origin/main, origin/main')).toBe('main')
  })

  it('跳过 tag 与 stash；空串返回 undefined', () => {
    expect(primaryBranch('tag: v1.0.0')).toBeUndefined()
    expect(primaryBranch('')).toBeUndefined()
  })
})

describe('Claude ai-title', () => {
  it('取最后一条（同会话重复写）', () => {
    const text = [
      '{"type":"ai-title","aiTitle":"旧标题"}',
      '{"type":"assistant","message":{"role":"assistant","content":"x"}}',
      '{"type":"ai-title","aiTitle":"举报分类前端渲染"}',
    ].join('\n')
    expect(extractAiTitle(text)).toBe('举报分类前端渲染')
  })

  it('无标题返回 undefined', () => {
    expect(extractAiTitle('{"type":"user"}')).toBeUndefined()
  })
})

describe('DSH session/title', () => {
  it('取最后一条 title 事件', () => {
    const text = [
      '{"type":"session/title","data":{"title":"早期标题"}}',
      '{"type":"session/title","data":{"title":"排查编译器内存溢出问题"}}',
    ].join('\n')
    expect(extractSessionTitle(text)).toBe('排查编译器内存溢出问题')
  })
})

describe('会话归属透传', () => {
  it('条目带上 group / groupTitle / role', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-09-08T10:00:00Z',
      message: { role: 'user', content: [{ type: 'text', text: '看下这个登录问题' }] },
    })
    const e = parseConversationLine(line, range, 'demo', { id: 's-1', title: '登录重构' })
    expect(e?.group).toBe('s-1')
    expect(e?.groupTitle).toBe('登录重构')
    expect(e?.role).toBe('user')
  })

  it('不传会话信息时不带分组字段', () => {
    const line = JSON.stringify({ type: 'user', timestamp: '2026-09-08T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: '你好' }] } })
    expect(parseConversationLine(line, range, 'demo')?.group).toBeUndefined()
  })
})
