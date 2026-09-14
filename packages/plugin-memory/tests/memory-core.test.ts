/**
 * 记忆核心的纯函数测试：作用域归一化、去重合并、导入解析、注入渲染与安全转义、
 * 自动提炼的解析与容错。这些是整个插件的行为边界，全部可离线验证。
 */

import { describe, expect, it } from 'vitest'
import {
  compareMemories,
  mergeContent,
  normalizeProjectKey,
  parseImportedText,
  projectLabelOf,
} from '../src/service.ts'
import { escapePromptVars, renderMemoryBlock, sessionCwdOf } from '../src/agent/prompt.ts'
import { collectTranscript, parseCapturedItems } from '../src/agent/capture.ts'
import { describeConflicts, detectToolConflicts } from '../src/conflicts.ts'
import { resolveProjectPath, sessionContextOf } from '../src/agent/tools.ts'
import { importanceLabel, type MemoryRecord } from '../src/types.ts'

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'm1' as MemoryRecord['id'],
    kind: 'fact',
    scope: 'global',
    projectPath: '',
    title: 'T',
    content: 'C',
    importance: 3,
    tags: [],
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    source: 'agent',
    ...overrides,
  }
}

describe('作用域与路径', () => {
  it('归一化忽略大小写、尾分隔符与斜杠方向', () => {
    expect(normalizeProjectKey('D:\\Codes\\Demo\\')).toBe('d:/codes/demo')
    expect(normalizeProjectKey('d:/codes/demo')).toBe(normalizeProjectKey('D:\\codes\\demo\\'))
  })

  it('项目显示名取末段', () => {
    expect(projectLabelOf('D:\\codes\\dsh-desk-studio')).toBe('dsh-desk-studio')
    expect(projectLabelOf('D:\\codes\\dsh-desk-studio\\')).toBe('dsh-desk-studio')
  })

  it('项目记忆缺项目路径时用会话 cwd 兜底；都没有则抛可读错误', () => {
    expect(resolveProjectPath(undefined, 'D:\\codes\\a')).toBe('D:\\codes\\a')
    expect(resolveProjectPath('D:\\codes\\b', 'D:\\codes\\a')).toBe('D:\\codes\\b')
    expect(() => resolveProjectPath(undefined, undefined)).toThrow(/project-scoped memory/)
  })
})

describe('合并与排序', () => {
  it('重复内容不叠加，新内容包含旧内容时取新的', () => {
    expect(mergeContent('喜欢简短回答', '喜欢简短回答')).toBe('喜欢简短回答')
    expect(mergeContent('喜欢简短回答', '喜欢简短回答，不要客套')).toBe('喜欢简短回答，不要客套')
    expect(mergeContent('A', 'B')).toBe('A\nB')
  })

  it('排序：置顶 > 重要性 > 最近更新', () => {
    const pinned = record({ id: 'p' as MemoryRecord['id'], pinned: true, importance: 1 })
    const high = record({ id: 'h' as MemoryRecord['id'], importance: 5 })
    const fresh = record({ id: 'f' as MemoryRecord['id'], importance: 5, updatedAt: 99 })
    const sorted = [high, pinned, fresh].sort(compareMemories).map((item) => item.id)
    expect(sorted).toEqual(['p', 'f', 'h'])
  })
})

describe('导入解析', () => {
  const text = [
    '\`\`\`',
    '## 指令',
    '- [2026-01-01] 回答先给结论，再给理由。',
    '- 不要用「作为一个 AI」这类开场白。',
    '',
    '## 身份',
    '[unknown] - 在杭州工作，偏好中文交流。',
    '',
    '## 项目',
    '- [2026-02-02] dsh-desk-studio：dsh 插件集合，正在做记忆插件。',
    '\`\`\`',
    '这是代码块之后的说明文字，也应被视为一条记录。',
  ].join('\n')

  it('识别小节标题、日期前缀与列表项', () => {
    const items = parseImportedText(text)
    expect(items.length).toBe(5)
    expect(items[0]?.kind).toBe('preference')
    expect(items[0]?.content).toBe('回答先给结论，再给理由。')
    expect(items[1]?.kind).toBe('preference')
    expect(items[2]?.kind).toBe('user')
    expect(items[3]?.kind).toBe('project')
    expect(items[3]?.title).toContain('dsh-desk-studio')
    expect(items[4]?.kind).toBe('project')
  })

  it('标题过长时截断到 40 字', () => {
    const long = '## 指令\n- ' + 'x'.repeat(120)
    expect((parseImportedText(long)[0]?.title ?? '').length).toBe(40)
  })

  it('空文本得到空结果', () => {
    expect(parseImportedText('')).toEqual([])
    expect(parseImportedText('   \n  ')).toEqual([])
  })

  it('纯文本无小节时全部归为事实', () => {
    const items = parseImportedText('第一行\n第二行')
    expect(items.map((item) => item.kind)).toEqual(['fact', 'fact'])
  })

  it('认不出分类的章节标题不收成记忆（文档大标题曾变成一条记录）', () => {
    const items = parseImportedText([
      '# 个人使用画像',
      '',
      '## 指令',
      '[2026-01-01] - 回答先给结论。',
      '',
      '## 其它说明',
      '未知小节下的正文，仍按当前分类收下。',
    ].join('\n'))
    expect(items.map((item) => item.title)).toEqual(['回答先给结论', '未知小节下的正文，仍按当前分类收下'])
    expect(items.every((item) => item.kind === 'preference')).toBe(true)
  })
})

describe('注入渲染与提示词安全', () => {
  it('无候选时不占用提示词预算', () => {
    expect(renderMemoryBlock([], undefined)).toBe('')
  })

  it('渲染分类、作用域、重要性并附当前工作区', () => {
    const text = renderMemoryBlock(
      [record({ title: '偏好', content: '先给结论', importance: 5, kind: 'preference' })],
      'D:\\codes\\demo',
    )
    expect(text).toContain('[指令 | 全局 | 关键] 偏好：先给结论')
    expect(text).toContain('当前工作区：D:\\codes\\demo')
  })

  it('重要性一律用中文等级，不再出现 ★', () => {
    expect(importanceLabel(1)).toBe('很低')
    expect(importanceLabel(3)).toBe('普通')
    expect(importanceLabel(5)).toBe('关键')
    // 越界与非法值夹到 1-5
    expect(importanceLabel(0)).toBe('很低')
    expect(importanceLabel(9)).toBe('关键')
    expect(importanceLabel(Number.NaN)).toBe('普通')
    const text = renderMemoryBlock(
      [record({ title: '偏好', content: '先给结论', importance: 5 })],
      undefined,
    )
    expect(text).not.toContain('★')
  })

  it('花括号被转义（否则 DSH interpolate 会把 {{x}} 当提示词变量并崩溃）', () => {
    const escaped = escapePromptVars('注意 {{hl|}} 与 {{关键词}}')
    expect(escaped).not.toContain('{{')
    expect(escaped).not.toContain('}}')
    expect(escapePromptVars(escaped)).toBe(escaped)
  })

  it('注入块里的花括号已被转义', () => {
    const text = renderMemoryBlock([record({ content: '用 {{hl|}} 标注' })], undefined)
    expect(text).not.toContain('{{')
  })

  it('从渲染上下文取会话 cwd，缺字段安全降级', () => {
    expect(sessionCwdOf({ agent: { session: { header: { cwd: 'D:\\a' } } } })).toBe('D:\\a')
    expect(sessionCwdOf({})).toBeUndefined()
    expect(sessionCwdOf(undefined)).toBeUndefined()
  })
})

describe('与其它记忆插件的冲突探测', () => {
  const names = ['memory_save', 'memory_search'] as const

  it('按名探测占用并带回对方描述', () => {
    const probe = {
      get: (name: string) => (name === 'memory_save' ? { description: 'Save a memory entry' } : undefined),
    }
    expect(detectToolConflicts(probe, names)).toEqual([
      { name: 'memory_save', description: 'Save a memory entry' },
    ])
  })

  it('无占用时返回空数组', () => {
    expect(detectToolConflicts({ get: () => undefined }, names)).toEqual([])
  })

  it('tools 未就绪或探测抛错都按无冲突处理（探测失败不得阻塞注册）', () => {
    expect(detectToolConflicts(undefined, names)).toEqual([])
    expect(detectToolConflicts({ get: () => { throw new Error('boom') } }, names)).toEqual([])
  })

  it('对方没给描述时降级为空串，不出现 undefined', () => {
    expect(detectToolConflicts({ get: () => ({}) }, ['memory_list']))
      .toEqual([{ name: 'memory_list', description: '' }])
  })

  it('摘要点名被占用的工具并给出处置建议', () => {
    const text = describeConflicts([{ name: 'memory_save', description: '' }])
    expect(text).toContain('memory_save')
    expect(text).toContain('只保留一个记忆插件')
    expect(describeConflicts([])).toBe('')
  })
})

describe('自动提炼', () => {
  it('从会话事件里取用户与助手文本', () => {
    const session = {
      events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: '我喜欢简洁' }] } },
        { type: 'assistant/message', data: { content: [{ type: 'text', text: '明白了' }] } },
        { type: 'tool/call', data: { content: [{ type: 'text', text: '不该出现' }] } },
      ],
    }
    const transcript = collectTranscript(session)
    expect(transcript).toContain('用户：我喜欢简洁')
    expect(transcript).toContain('助手：明白了')
    expect(transcript).not.toContain('不该出现')
  })

  it('会话结构异常时安全返回空串', () => {
    expect(collectTranscript(undefined)).toBe('')
    expect(collectTranscript({ events: 'nope' })).toBe('')
  })

  it('解析模型输出并丢弃非法项', () => {
    const items = parseCapturedItems('前言 [{"title":"a","content":"b","kind":"preference","scope":"project"},'
      + '{"title":"","content":"x"},{"title":"c","content":"d","kind":"nope","scope":"nope"}] 后记')
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ title: 'a', content: 'b', kind: 'preference', scope: 'project' })
    expect(items[1]).toEqual({ title: 'c', content: 'd', kind: 'fact', scope: 'global' })
  })

  it('非 JSON 输出不抛错', () => {
    expect(parseCapturedItems('没有值得记的')).toEqual([])
    expect(parseCapturedItems('')).toEqual([])
  })
})

describe('工具会话上下文', () => {
  it('取到 session id 与 cwd', () => {
    expect(sessionContextOf({ agent: { session: { id: 's1', header: { cwd: 'D:\\a' } } } }))
      .toEqual({ sessionId: 's1', cwd: 'D:\\a' })
  })

  it('结构缺失时返回空对象而不抛错', () => {
    expect(sessionContextOf(undefined)).toEqual({})
    expect(sessionContextOf({})).toEqual({})
    expect(sessionContextOf({ agent: {} })).toEqual({})
  })
})
