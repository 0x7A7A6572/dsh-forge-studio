/**
 * DSH 会话渠道：多帧 zstd 解码 + 正文行解析 + 归属匹配（不依赖目录名编码）。
 * 覆盖：只取 text 块（丢 reasoning）、跳过 inbox/chunk 重复、v0/v3 同会话只取一份。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { dshChannel, decodeSessionBuffer, parseDshSessionLine } from '../src/sources/dsh.ts'

const SESSION = 'session-11111111-2222-3333-4444-555555555555'
const PROJECT = 'C:\\Users\\me\\CODE\\demo'
const OTHER = 'C:\\Users\\me\\CODE\\other'

const AT = (iso: string): number => Date.parse(iso)

function frame(line: string): Buffer {
  return zstdCompressSync(Buffer.from(line + '\n', 'utf8'))
}
function encode(lines: string[]): Buffer {
  return Buffer.concat(lines.map(frame))
}
const header = (cwd: string): string =>
  JSON.stringify({ type: 'session', version: 3, id: SESSION, createdAt: AT('2026-09-08T01:00:00Z'), cwd })
const userLine = (text: string, iso: string): string =>
  JSON.stringify({ type: 'user/message', seq: 1, time: AT(iso), data: { content: [{ type: 'text', text }], role: 'user' } })
const assistantLine = (text: string, iso: string): string =>
  JSON.stringify({
    type: 'assistant/message',
    seq: 2,
    time: AT(iso),
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '内部推理不应出现在正文' }, { type: 'text', text }] } },
  })
const inboxLine = (text: string, iso: string): string =>
  JSON.stringify({ type: 'agent/inbox/spliced', seq: 3, time: AT(iso), data: { target: 'next-turn', inserted: [{ content: [{ type: 'text', text }] }] } })

/** 落盘一个会话目录：v3 多帧 + v0 镜像（镜像内容必须被忽略）。 */
async function writeSession(root: string, dirName: string, cwd: string, lines: string[]): Promise<void> {
  const dir = join(root, dirName, SESSION)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.v3.jsonl.zstd'), encode([header(cwd), ...lines]))
  await writeFile(join(dir, 'session.jsonl.zstd'), encode([header(cwd), '{"type":"assistant/chunk","time":0,"data":{"chunk":{"type":"text"}}}']))
}

const range = { since: '2026-09-08', until: '2026-09-09' }
let root = ''
let prevHome: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dlog-dsh-'))
  prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  await writeSession(join(root, 'sessions'), '--C-Users-me--CODE-demo--', PROJECT, [
    userLine('hake 内存泄漏排查：先定位根因', '2026-09-08T02:00:00Z'),
    assistatantGuard(),
    assistantLine('已完成根因定位，结论如下。', '2026-09-08T02:05:00Z'),
    inboxLine('hake 内存泄漏排查：先定位根因', '2026-09-08T02:00:00Z'),
    userLine('窗口外的问题', '2026-09-20T02:00:00Z'),
  ])
  await writeSession(join(root, 'sessions'), '--C-Users-me--CODE-other--', OTHER, [userLine('别的项目', '2026-09-08T03:00:00Z')])
})

function assistatantGuard(): string {
  return JSON.stringify({ type: 'assistant/message', seq: 2, time: AT('2026-09-08T02:01:00Z'), data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '只有推理，没有正文' }, { type: 'tool-call', id: 'c1', name: 'read' }] } } })
}

afterEach(async () => {
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  await rm(root, { recursive: true, force: true })
})

describe('decodeSessionBuffer：多帧 zstd', () => {
  it('逐帧解压拼回全文（单帧解压只能拿到第一行）', () => {
    const buf = encode([header(PROJECT), userLine('第一条', '2026-09-08T02:00:00Z'), assistantLine('第二条', '2026-09-08T02:05:00Z')])
    const text = decodeSessionBuffer(buf)
    expect(text.split('\n').filter(Boolean)).toHaveLength(3)
    expect(text).toContain('第二条')
  })

  it('明文 jsonl 原样返回', () => {
    const plain = Buffer.from('{"type":"user/message"}\n', 'utf8')
    expect(decodeSessionBuffer(plain)).toContain('user/message')
  })
})

describe('parseDshSessionLine：只取可见正文', () => {
  it('user/message → [提问]', () => {
    const e = parseDshSessionLine(userLine('你好', '2026-09-08T02:00:00Z'), range, 'demo')
    expect(e?.title).toBe('[提问] 你好')
    expect(e?.kind).toBe('conversation')
  })

  it('assistant/message 只取 text 块，丢弃 reasoning', () => {
    const e = parseDshSessionLine(assistantLine('结论如下', '2026-09-08T02:05:00Z'), range, 'demo')
    expect(e?.body).toBe('结论如下')
    expect(e?.title).toBe('[回答] 结论如下')
  })

  it('只有推理/工具调用的助手消息不产出条目', () => {
    expect(parseDshSessionLine(assistatantGuard(), range, 'demo')).toBeUndefined()
  })

  it('agent/inbox/spliced 与 assistant/chunk 不产出（避免与 user/message 重复）', () => {
    expect(parseDshSessionLine(inboxLine('你好', '2026-09-08T02:00:00Z'), range, 'demo')).toBeUndefined()
    expect(parseDshSessionLine('{"type":"assistant/chunk","time":0,"data":{}}', range, 'demo')).toBeUndefined()
  })

  it('时间窗外的行被过滤', () => {
    expect(parseDshSessionLine(userLine('窗口外', '2026-09-20T02:00:00Z'), range, 'demo')).toBeUndefined()
  })

  it('宿主注入的 user 消息（source.kind 非 user）不产出', () => {
    const withKind = (kind: string, text: string): string =>
      JSON.stringify({
        type: 'user/message',
        seq: 4,
        time: AT('2026-09-08T02:00:00Z'),
        data: { content: [{ type: 'text', text }], source: { kind } },
      })
    for (const kind of ['plugin', 'agent-instructions', 'skill-catalog', 'system']) {
      expect(parseDshSessionLine(withKind(kind, 'Current runtime context.'), range, 'demo')).toBeUndefined()
    }
    expect(parseDshSessionLine(withKind('user', '真实提问'), range, 'demo')?.title).toBe('[提问] 真实提问')
  })
})

describe('dshChannel：按会话头部 cwd 归属项目', () => {
  it('probe 命中/不命中', async () => {
    expect(await dshChannel.probe(PROJECT)).toBe(true)
    expect(await dshChannel.probe(join(root, 'nope'))).toBe(false)
  })

  it('scan 只取本项目、窗口内、且 v0/v3 不重复', async () => {
    const entries = await dshChannel.scan({ path: PROJECT, label: 'demo', range })
    expect(entries.map((e) => e.title)).toEqual(['[提问] hake 内存泄漏排查：先定位根因', '[回答] 已完成根因定位，结论如下。'])
    expect(entries.every((e) => e.sourceLabel === 'demo')).toBe(true)
  })

  it('未命中项目返回空数组', async () => {
    expect(await dshChannel.scan({ path: join(root, 'nope'), label: 'x', range })).toEqual([])
  })
})
