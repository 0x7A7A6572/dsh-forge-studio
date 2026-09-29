/**
 * 主题路由的门禁。请求路径**从不参与**文件系统路径拼接 —— 这条是这里最重要的断言：
 * 一个 `../../` 的请求必须 404，而不是把宿主上的文件读出去。
 *
 * 另外两类不许退化：
 * - **挂载对激活顺序不敏感**。本插件只 `inject: ['storageDomain']`，WebServer 的服务
 *   provider 可能后到；若后到就永久不挂，整条 HTTP 半边静默失效（类型/构建/测试全绿）。
 *   所以下面用假容器把「服务后到」这条路径钉住。
 * - **响应头是全部路由共享的**。manifest / 产物 / 404 都走 `send()`，任何一条退化了都算回归。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createThemeTranspiler } from '../packages/plugin-usage-billing/src/themes/transpile.ts'
import {
  THEMES_ROUTE_PATH,
  createThemesHandler,
  installThemesRoute,
} from '../packages/plugin-usage-billing/src/themes/route.ts'
import type { ThemesHandlerOptions } from '../packages/plugin-usage-billing/src/themes/route.ts'

let root = ''
let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
let options: ThemesHandlerOptions

/** 一张够用的假响应：只记状态码、头与正文。 */
function fakeResponse(): { res: ServerResponse; status: () => number; body: () => string; headers: () => Record<string, unknown> } {
  let status = 0
  let body = ''
  const headers: Record<string, unknown> = {}
  const res = {
    writeHead(code: number, head?: Record<string, unknown>) {
      status = code
      Object.assign(headers, head ?? {})
      return this
    },
    end(chunk?: string) { body = chunk ?? '' },
  } as unknown as ServerResponse
  return { res, status: () => status, body: () => body, headers: () => headers }
}

async function get(path: string): Promise<{ status: number; body: unknown; headers: Record<string, unknown> }> {
  const fake = fakeResponse()
  await handler({ url: path } as IncomingMessage, fake.res)
  return { status: fake.status(), body: fake.body(), headers: fake.headers() }
}

function theme(id: string, source: string, style?: string): void {
  mkdirSync(join(root, id), { recursive: true })
  writeFileSync(join(root, id, 'index.tsx'), source, 'utf8')
  if (style !== undefined) writeFileSync(join(root, id, 'styles.css'), style, 'utf8')
}

const OK = `export const theme = { label: '示例', component: () => null }
`

const BAD = `import x from 'lodash'
export const theme = { label: 'x', component: () => x }
`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ub-route-'))
  options = { root, transpiler: createThemeTranspiler() }
  handler = createThemesHandler(options)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('manifest', () => {
  it('列出全部主题，url 指回自己；带样式的多一个 cssUrl', async () => {
    theme('line', OK, '.a{}')
    theme('plain', OK)
    const res = await get(`${THEMES_ROUTE_PATH}/manifest.json`)
    expect(res.status).toBe(200)
    const manifest = JSON.parse(res.body as string) as { themes: unknown[]; broken: unknown[] }
    expect(manifest.themes).toEqual([
      { id: 'line', url: `${THEMES_ROUTE_PATH}/line.js`, cssUrl: `${THEMES_ROUTE_PATH}/line.css` },
      { id: 'plain', url: `${THEMES_ROUTE_PATH}/plain.js` },
    ])
    expect(manifest.broken).toEqual([])
  })

  it('转译失败的主题进 broken（带原因），不进 themes', async () => {
    theme('bad', BAD)
    const manifest = JSON.parse((await get(`${THEMES_ROUTE_PATH}/manifest.json`)).body as string) as {
      themes: unknown[]
      broken: { id: string; reason: string }[]
    }
    expect(manifest.themes).toEqual([])
    expect(manifest.broken[0]?.id).toBe('bad')
    expect(manifest.broken[0]?.reason).toContain('lodash')
  })

  it('同目录下一好一坏：好的照常列出，坏的不带走它', async () => {
    theme('good', OK, '.a{}')
    theme('bad', BAD)
    const manifest = JSON.parse((await get(`${THEMES_ROUTE_PATH}/manifest.json`)).body as string) as {
      themes: { id: string }[]
      broken: { id: string; reason: string }[]
    }
    expect(manifest.themes.map((row) => row.id)).toEqual(['good'])
    expect(manifest.broken.map((row) => row.id)).toEqual(['bad'])
    expect(manifest.broken[0]?.reason).toContain('lodash')
  })

  it('manifest 也是 no-store + json，坏主题不阻断清单本身', async () => {
    theme('bad', BAD)
    const res = await get(`${THEMES_ROUTE_PATH}/manifest.json`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(String(res.headers['cache-control'])).toContain('no-store')
  })

  it('没有主题目录也是 200 + 空清单', async () => {
    rmSync(root, { recursive: true, force: true })
    const manifest = JSON.parse((await get(`${THEMES_ROUTE_PATH}/manifest.json`)).body as string) as { themes: unknown[] }
    expect(manifest.themes).toEqual([])
  })
})

describe('产物', () => {
  it('js 是转译产物，Content-Type 是 javascript', async () => {
    theme('line', OK)
    const res = await get(`${THEMES_ROUTE_PATH}/line.js`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8')
    expect(res.body as string).toContain('__usageBillingThemeHost.define("line"')
  })

  it('css 原样下发', async () => {
    theme('line', OK, '.ub-line{color:red}')
    const res = await get(`${THEMES_ROUTE_PATH}/line.css`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8')
    expect(String(res.headers['cache-control'])).toContain('no-store')
    expect(res.body).toBe('.ub-line{color:red}')
  })

  it('不存在的 id 是 404', async () => {
    expect((await get(`${THEMES_ROUTE_PATH}/nope.js`)).status).toBe(404)
  })

  it('404 也走 send()：no-store + text/plain', async () => {
    const res = await get(`${THEMES_ROUTE_PATH}/nope.js`)
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(String(res.headers['cache-control'])).toContain('no-store')
  })

  it('坏主题的产物是 404（没有产物），原因留在 manifest 里', async () => {
    theme('bad', BAD, '.a{}')
    expect((await get(`${THEMES_ROUTE_PATH}/bad.js`)).status).toBe(404)
    expect((await get(`${THEMES_ROUTE_PATH}/bad.css`)).status).toBe(404)
    const manifest = JSON.parse((await get(`${THEMES_ROUTE_PATH}/manifest.json`)).body as string) as {
      broken: { id: string; reason: string }[]
    }
    expect(manifest.broken[0]?.id).toBe('bad')
    expect(manifest.broken[0]?.reason).toContain('lodash')
  })

  it('没有 styles.css 的主题请求 css 是 404', async () => {
    theme('plain', OK)
    expect((await get(`${THEMES_ROUTE_PATH}/plain.css`)).status).toBe(404)
  })

  it('路径穿越拿不到宿主上的文件', async () => {
    for (const path of [
      `${THEMES_ROUTE_PATH}/../package.json`,
      `${THEMES_ROUTE_PATH}/..%2Fpackage.json`,
      `${THEMES_ROUTE_PATH}/%2e%2e%2f%2e%2e%2fpackage.json`,
    ]) {
      expect((await get(path)).status).toBe(404)
    }
  })

  it('一律 no-store：刷新页面必须看到刚改的主题', async () => {
    theme('line', OK)
    const res = await get(`${THEMES_ROUTE_PATH}/line.js`)
    expect(String(res.headers['cache-control'])).toContain('no-store')
  })
})

/**
 * FIX 1 的回归门禁：挂载对**激活顺序**不敏感。
 *
 * `webServer` 是可选服务，不能进插件顶层 `inject`（那会让计费插件的激活依赖 WebServer），
 * 所以走的必须是 `ctx.inject(['webServer'], cb)` —— provider 已就位时立刻跑 cb，
 * 否则把 fiber 停在 inactive 等它出现。这几条用假容器把两条时序都钉死。
 */
describe('挂载', () => {
  /** 记录 register 的调用；调用返回的 disposer 供断言。 */
  function fakeWebServer(): {
    webServer: { register(route: unknown): () => void }
    calls: unknown[]
    unregisterCalls: () => number
  } {
    const calls: unknown[] = []
    let unregisters = 0
    const webServer = {
      register(route: unknown) {
        calls.push(route)
        return () => { unregisters += 1 }
      },
    }
    return { webServer, calls, unregisterCalls: () => unregisters }
  }

  /** ctx 的最小假件：只记下 inject 的回调与依赖表，服务何时出现由测试自己决定。 */
  function fakeContainer(): {
    ctx: Context
    deps: () => string[]
    /** 模拟 provider 上线：cordis 那侧就是 notify() 回放这个回调。 */
    appear: (webServer: unknown) => void
  } {
    let cb: ((ctx: unknown) => void) | undefined
    let seen: string[] = []
    const ctx = {
      get: () => undefined,
      inject(deps: string[], callback: (ctx: unknown) => void) {
        seen = deps
        cb = callback
        return undefined
      },
    }
    return {
      ctx: ctx as unknown as Context,
      deps: () => seen,
      appear(webServer: unknown) {
        cb?.({ get: (name: string) => (name === 'webServer' ? webServer : undefined) })
      },
    }
  }

  it('服务后到也会挂上：register 收到 { kind: prefix, path: THEMES_ROUTE_PATH }', () => {
    const container = fakeContainer()
    const { webServer, calls } = fakeWebServer()
    installThemesRoute(container.ctx, options)
    expect(container.deps()).toEqual(['webServer'])
    // apply 已经跑完了，服务此刻仍不在 —— 这就是旧实现会永久静默跳过的时刻。
    expect(calls).toEqual([])
    container.appear(webServer)
    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual({
      kind: 'prefix',
      path: THEMES_ROUTE_PATH,
      handler: expect.any(Function),
    })
  })

  it('服务始终不出现：什么都不注册，apply 不抛', () => {
    const container = fakeContainer()
    const { calls } = fakeWebServer()
    expect(() => installThemesRoute(container.ctx, options)).not.toThrow()
    expect(calls).toEqual([])
    // 事后服务仍不出现 —— 依旧什么都不该发生。
    expect(calls).toEqual([])
  })

  it('返回值就是 register 给的 disposer：调用它即反注册', () => {
    const container = fakeContainer()
    const { webServer, unregisterCalls } = fakeWebServer()
    const dispose = installThemesRoute(container.ctx, options)
    container.appear(webServer)
    expect(unregisterCalls()).toBe(0)
    dispose()
    expect(unregisterCalls()).toBe(1)
  })

  it('服务未出现就 dispose：之后的回放不再注册', () => {
    const container = fakeContainer()
    const { webServer, calls } = fakeWebServer()
    const dispose = installThemesRoute(container.ctx, options)
    dispose()
    container.appear(webServer)
    expect(calls).toEqual([])
  })
})
