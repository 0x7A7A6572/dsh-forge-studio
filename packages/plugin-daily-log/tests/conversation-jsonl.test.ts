/**
 * 宿主注入壳的过滤/剥离：IDE 上下文、环境说明、AGENTS.md 提示、控制行等。
 * 核心口径：先剥壳，剥完为空才丢整条；正文里的普通尖括号不能被误伤。
 */

import { describe, expect, it } from 'vitest'
import { parseConversationLine } from '../src/sources/conversation-jsonl.ts'

const range = { since: '2026-09-01', until: '2026-10-01' }

function claudeUser(blocks: string[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-09-08T10:00:00Z',
    message: { role: 'user', content: blocks.map((text) => ({ type: 'text', text })) },
    ...extra,
  })
}

function codexUser(blocks: string[], ts = '2026-09-08T06:01:09Z'): string {
  return JSON.stringify({
    type: 'response_item',
    timestamp: ts,
    payload: { type: 'message', role: 'user', content: blocks.map((text) => ({ type: 'input_text', text })) },
  })
}

describe('注入壳：剥离而非直接丢弃', () => {
  it('IDE 壳块 + 真问题 → 保留真问题（壳不占标题）', () => {
    const line = claudeUser([
      '<ide_opened_file>The user opened the file a.vue in the IDE. This may or may not be related to the current task.</ide_opened_file>',
      '你在往什么奇怪的方向排查啊？我的问题是接口返回了正确的树形数据，但是前端渲染二级时数据对不上',
    ])
    const e = parseConversationLine(line, range, 'demo')
    expect(e?.title).toBe('[提问] 你在往什么奇怪的方向排查啊？我的问题是接口返回了正确的树形数据，但是前端渲染二级时数据对不上')
    expect(e?.body.startsWith('<ide_opened_file>')).toBe(false)
  })

  it('只有壳块 → 整条丢弃', () => {
    const only = claudeUser(['<ide_selection>The user selected the lines 245 to 245 from home.vue</ide_selection>'])
    expect(parseConversationLine(only, range, 'demo')).toBeUndefined()
  })

  it('isMeta（技能基目录）→ 丢弃', () => {
    const line = claudeUser(['Base directory for this skill: C:/plugins/superpowers'], { isMeta: true })
    expect(parseConversationLine(line, range, 'demo')).toBeUndefined()
  })

  it('任务通知 / 中断控制行 → 丢弃', () => {
    expect(parseConversationLine(claudeUser(['任务完成'], { origin: { kind: 'task-notification' } }), range, 'demo')).toBeUndefined()
    expect(parseConversationLine(claudeUser(['[Request interrupted by user]']), range, 'demo')).toBeUndefined()
  })

  it('Claude 的 system-reminder 块被剥离后保留真问题', () => {
    const line = claudeUser([
      '帮我把这个函数拆一下',
      '<system-reminder> The following workspace instructions may be relevant. Use them as guidance. </system-reminder>',
    ])
    expect(parseConversationLine(line, range, 'demo')?.body).toBe('帮我把这个函数拆一下')
  })
})

describe('Codex 轮首注入消息', () => {
  it('AGENTS.md + 环境上下文（无真问题）→ 丢弃', () => {
    const line = codexUser([
      '# AGENTS.md instructions <INSTRUCTIONS> ### 关于我 前端开发工程师 </INSTRUCTIONS>',
      '<environment_context> <cwd>D:\\codes\\novelcraft</cwd> <shell>powershell</shell> </environment_context>',
    ])
    expect(parseConversationLine(line, range, 'demo')).toBeUndefined()
  })

  it('真提问（单独一条消息）→ 保留', () => {
    const line = codexUser(['你侧边栏的项目，在本地哪个文件夹啊？'], '2026-09-08T06:01:10Z')
    expect(parseConversationLine(line, range, 'demo')?.body).toBe('你侧边栏的项目，在本地哪个文件夹啊？')
  })
})

describe('不误伤', () => {
  it('正文里的普通尖括号内容原样保留', () => {
    const line = claudeUser(['命令是 <name> 与 <args> 两个占位符，模板里还有 <div> 标签'])
    const body = parseConversationLine(line, range, 'demo')?.body
    expect(body).toContain('<name>')
    expect(body).toContain('<div>')
  })

  it('助手正文不做剥壳（可能正当地讨论这些标签）', () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-09-08T10:05:00Z',
      message: { role: 'assistant', content: [{ type: 'text', text: '这个 <system-reminder> 是宿主注入的' }] },
    })
    expect(parseConversationLine(line, range, 'demo')?.body).toBe('这个 <system-reminder> 是宿主注入的')
  })
})
