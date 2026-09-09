/**
 * webdav 引擎集成冒烟：本地内存 WebDAV 服务器（HTTP Basic + MKCOL/PUT/
 * PROPFIND/GET/DELETE 最小语义）对引擎端到端验证——改配置即试跑上传、按 keep
 * 清理、恢复先自动备份再整体重建、错误认证结构化失败、定时检查无变更不重复传。
 * 不依赖任何外部网络；服务器仅监听回环随机端口。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { createWebdavEngine } from '../src/webdav-backup.ts'
import type { WebdavRunner } from '../src/webdav-backup.ts'
import type { NoteRecord } from '../src/types.ts'
import type { WebdavMeta } from '../src/webdav-domain.ts'
import { emptyWebdavMeta, WEBDAV_META_KEY } from '../src/webdav-domain.ts'

const USER = 'smoke-user'
const PASS = 'smoke-pass'

/** 极简 WebDAV 内存实现（行为对齐常见服务器：父目录不存在时 PUT 返回 409）。 */
function createDavServer() {
  const files = new Map<string, string>() // 规范路径(无尾斜杠) -> 内容
  const dirs = new Set<string>()
  const norm = (p: string) => p.replace(/\/+/g, '/').replace(/\/$/g, '') || '/'
  const parentOf = (p: string) => norm(p.slice(0, p.lastIndexOf('/')) || '/')

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? ''
    if (auth !== 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="dav"' })
      res.end()
      return
    }
    const path = norm(decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname))
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const method = req.method ?? 'GET'
      if (method === 'MKCOL') {
        if (dirs.has(path)) {
          res.writeHead(405)
          res.end()
        } else {
          dirs.add(path)
          res.writeHead(201)
          res.end()
        }
        return
      }
      if (method === 'PUT') {
        if (path !== '/' && !dirs.has(parentOf(path))) {
          res.writeHead(409)
          res.end()
          return
        }
        files.set(path, body)
        res.writeHead(201)
        res.end()
        return
      }
      if (method === 'DELETE') {
        if (files.delete(path)) res.writeHead(204)
        else res.writeHead(404)
        res.end()
        return
      }
      if (method === 'GET') {
        const contentBody = files.get(path)
        if (contentBody === undefined) {
          res.writeHead(404)
          res.end()
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(contentBody)
        }
        return
      }
      if (method === 'PROPFIND') {
        if (!dirs.has(path) && path !== '/') {
          res.writeHead(404)
          res.end()
          return
        }
        const children = [...new Set([...files.keys(), ...dirs])].filter(
          (name) => parentOf(name) === path,
        )
        children.sort()
        const rows = children
          .map(
            (name) =>
              '<D:response><D:href>' +
              new URL(name, 'http://localhost').pathname +
              '</D:href></D:response>',
          )
          .join('')
        res.writeHead(207, { 'Content-Type': 'application/xml; charset=utf-8' })
        res.end(
          '<?xml version="1.0" encoding="utf-8"?>' +
            '<D:multistatus xmlns:D="DAV:">' +
            rows +
            '</D:multistatus>',
        )
        return
      }
      res.writeHead(501)
      res.end()
    })
  })
  return { server, files }
}

function note(id: string, title: string, updatedAt: number): NoteRecord {
  return {
    id: id as NoteRecord['id'],
    title,
    text: 'body-' + title,
    pinned: false,
    archived: false,
    color: 'yellow',
    origin: 'user',
    createdAt: updatedAt,
    updatedAt,
  }
}

let base = ''
const dav = createDavServer()
const replaced: NoteRecord[] = []
let currentNotes: NoteRecord[] = []

function fakeMetaTable(): KvTable<string, WebdavMeta> {
  const map = new Map<string, WebdavMeta>()
  return {
    get: (key: string) => map.get(key) ?? undefined,
    put: async (key: string, value: WebdavMeta) => {
      map.set(key, value)
    },
    delete: async () => false,
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    clear: async () => {
      map.clear()
    },
    size: () => map.size,
  } as unknown as KvTable<string, WebdavMeta>
}

function makeContext(password: string): Context {
  const ctx = {
    settings: {
      get: () => ({
        webdav: {
          enabled: true,
          url: base,
          username: USER,
          password,
          path: 'dsh/notes/',
          intervalMin: 30,
          keep: 2,
        },
      }),
    },
    logger: { warn: (..._args: unknown[]) => undefined },
    // 模拟 cordis ctx.inject：settings 恒可用，微任务内回调携带 settings 上下文。
    inject: (_names: string[], callback: (inner: unknown) => void) => {
      setTimeout(() => callback(ctx), 0)
      return Promise.resolve()
    },
  } as unknown as Context
  return ctx
}

let runner: WebdavRunner
let meta: KvTable<string, WebdavMeta>

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    dav.server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = dav.server.address() as AddressInfo
  base = 'http://127.0.0.1:' + address.port + '/dav/'
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    dav.server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('webdav 引擎端到端（本地 mock）', () => {
  it('改配置即试跑：首次备份建目录上传成功，meta 落盘', async () => {
    currentNotes = [note('a', 'alpha', 1), note('b', 'bravo', 2), note('c', 'charlie', 3)]
    meta = fakeMetaTable()
    await meta.put(WEBDAV_META_KEY, emptyWebdavMeta())
    runner = createWebdavEngine(makeContext(PASS), {
      listNotes: () => currentNotes,
      replaceAll: async (notes) => {
        replaced.length = 0
        replaced.push(...notes)
      },
      metaTable: meta,
    })
    const result = await runner.backupNow()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.snapshot).toMatch(/^notes-\d{8}-\d{6}\.json$/u)
    const m = (await meta.get(WEBDAV_META_KEY))!
    expect(m.lastBackupOk).toBe(true)
    expect(m.lastBackupName).toMatch(/\.json$/u)
    expect(m.watermark).toBe(3)
  })

  it('第二次备份后按 keep=2 只留最近两份', async () => {
    currentNotes = [...currentNotes, note('d', 'delta', 4), note('e', 'echo', 5)]
    const result = await runner.backupNow()
    expect(result.ok).toBe(true)
    const listed = await runner.listFiles()
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.files).toHaveLength(2)
    if (listed.ok) expect(listed.files[0]!).toMatch(/\.json$/u)
  })

  it('定时检查：距上次成功不足间隔不重复上传', async () => {
    const before = await runner.listFiles()
    expect(before.ok).toBe(true)
    await runner.checkAutomatic()
    const after = await runner.listFiles()
    expect(after.ok).toBe(true)
    if (before.ok && after.ok) expect(after.files).toEqual(before.files)
  })

  it('错误密码 → 结构化失败（HTTP 401）并记入 meta', async () => {
    const bad = createWebdavEngine(makeContext('wrong'), {
      listNotes: () => currentNotes,
      replaceAll: async (notes) => {
        replaced.length = 0
        replaced.push(...notes)
      },
      metaTable: meta,
    })
    const result = await bad.backupNow()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('401')
    const m = (await meta.get(WEBDAV_META_KEY))!
    expect(m.lastBackupOk).toBe(false)
    expect(m.lastBackupError).toContain('401')
  })

  it('恢复最近快照：先自动备份当前，再整体重建为快照内容', async () => {
    const snapshotNotes = currentNotes // 5 条
    currentNotes = [note('f', 'foxtrot', 6)] // 本地只剩 1 条
    const result = await runner.restore('latest')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.restored).toBe(snapshotNotes.length)
      expect(replaced.map((n) => n.title).sort()).toEqual(snapshotNotes.map((n) => n.title).sort())
    }
    const m = (await meta.get(WEBDAV_META_KEY))!
    expect(m.lastRestoreOk).toBe(true)
    expect(m.lastRestoreName).toMatch(/\.json$/u)
    const listed = await runner.listFiles()
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.files.length).toBeGreaterThan(0)
  })

  it('未启用/缺配置 → 直接结构化失败而非抛出', async () => {
    const ctx = {
      settings: { get: () => ({ webdav: { enabled: false } }) },
      logger: { warn: () => undefined },
      inject: (_names: string[], callback: (inner: unknown) => void) => {
        setTimeout(() => callback(ctx), 0)
        return Promise.resolve()
      },
    } as unknown as Context
    const disabled = createWebdavEngine(ctx, {
      listNotes: () => [],
      replaceAll: async () => undefined,
      metaTable: meta,
    })
    const result = await disabled.backupNow()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('未启用')
  })
})