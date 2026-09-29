/**
 * 主题路由：把磁盘上的主题下发给浏览器。
 *
 * | 请求 | 响应 |
 * |---|---|
 * | `GET /usage-billing/themes/manifest.json` | `{ themes: [{ id, url, cssUrl? }], broken: [{ id, reason }] }` |
 * | `GET /usage-billing/themes/<id>.js` | 转译产物（自调 define 的 IIFE） |
 * | `GET /usage-billing/themes/<id>.css` | `styles.css` 原文 |
 * | 其它 | 404 |
 *
 * 上表是字面契约：**转不过去的主题没有产物**，`<id>.js` / `<id>.css` 与未知 id 同样是 404。
 * 失败原因不在这里吞掉 —— 它照旧出现在 manifest 的 `broken[].reason` 里。
 *
 * 三个刻意的取舍：
 * - **manifest 里没有 label**。label 写在主题源码里，node 侧要拿到它就得执行主题代码 ——
 *   那是把用户磁盘上的任意代码拉进宿主进程。label 由主题在浏览器里自报。
 * - **manifest 里有 broken**。转译错误如果只能靠 `<script>` 失败来发现，浏览器拿不到原因
 *   （`onerror` 读不到响应体）。所以生成 manifest 时逐主题转译一遍（有缓存，代价可忽略），
 *   失败连同原因一起下发。
 * - **请求路径从不参与 fs 拼接**。`<id>` 只用来在扫盘结果里查表；查不到就是 404，
 *   路径穿越在构造上不可能。
 *
 * 一律 `no-store`：这套机制的生效方式就是「刷新页面」。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ThemeTranspiler } from './transpile.ts'
import { discoverThemes, type ThemeSource } from './discover.ts'

/** 路由前缀。client 侧的同名常量在 core/themes/manifest.ts。 */
export const THEMES_ROUTE_PATH = '/usage-billing/themes'

/** manifest 里的一条主题。 */
export interface ThemeManifestRow {
  readonly id: string
  readonly url: string
  readonly cssUrl?: string
}

/** 扫到了、但转译过不去的主题。reason 直接给用户看。 */
export interface ThemeManifestBroken {
  readonly id: string
  readonly reason: string
}

export interface ThemeManifest {
  readonly themes: readonly ThemeManifestRow[]
  readonly broken: readonly ThemeManifestBroken[]
}

export interface ThemesHandlerOptions {
  readonly root: string
  readonly transpiler: ThemeTranspiler
}

/**
 * 产物文件名：`/<id>.js` / `/<id>.css`。
 *
 * 前导 `/` 是必须的：这里的输入是扣掉前缀之后的 `pathname.slice(...)`，永远以 `/` 开头
 * （brief 里给的正则漏了这个斜杠，那样写连 `/line.js` 都匹配不上，等于整条产物路由恒 404）。
 * 除这个斜杠外没有放宽任何东西：id 仍然是白名单字符集，路径穿越照旧在构造上不可能。
 */
const ARTIFACT = /^\/([a-z0-9][a-z0-9-]*)\.(js|css)$/

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 产物内容，**一个主题一份**：转译抛出的算「这个主题坏了」，返回 `undefined`。
 *
 * 先过 `js()` —— 那是 manifest 判定 broken 的同一个判据。坏主题**整份没有产物**：
 * 它的 `.css` 即便自身能转出来也不下发，否则「坏主题的 `<id>.css` 是 404」这条契约
 * 会变成「要看它坏在哪一半」，与表的字面意思不符。
 *
 * try/catch 必须包在单个主题上 —— 包住整个循环会让一个坏主题把好主题一起带走。
 */
async function artifactOf(
  options: ThemesHandlerOptions,
  source: ThemeSource,
  ext: string,
): Promise<string | undefined> {
  try {
    const script = await options.transpiler.js(source)
    if (ext === 'css') {
      return source.style === undefined ? undefined : await options.transpiler.css(source)
    }
    return script
  } catch {
    return undefined
  }
}

/** 生成 manifest：逐主题转译，成功的进 themes，失败的进 broken。 */
async function manifestOf(options: ThemesHandlerOptions): Promise<ThemeManifest> {
  const themes: ThemeManifestRow[] = []
  const broken: ThemeManifestBroken[] = []
  for (const source of discoverThemes(options.root)) {
    try {
      await options.transpiler.js(source)
    } catch (error) {
      broken.push({ id: source.id, reason: describe(error) })
      continue
    }
    themes.push({
      id: source.id,
      url: `${THEMES_ROUTE_PATH}/${source.id}.js`,
      ...(source.style === undefined ? {} : { cssUrl: `${THEMES_ROUTE_PATH}/${source.id}.css` }),
    })
  }
  return { themes, broken }
}

/** 主题请求处理器，交给 `ctx.webServer.register({ kind: 'prefix', ... })`。 */
export function createThemesHandler(
  options: ThemesHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const rest = pathname.startsWith(THEMES_ROUTE_PATH)
      ? pathname.slice(THEMES_ROUTE_PATH.length)
      : undefined
    if (rest === undefined) {
      send(res, 404, 'text/plain; charset=utf-8', 'not found')
      return
    }
    if (rest === '/manifest.json') {
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify(await manifestOf(options)))
      return
    }
    const match = ARTIFACT.exec(rest)
    if (match === null) {
      send(res, 404, 'text/plain; charset=utf-8', 'not found')
      return
    }
    const [, id, ext] = match
    const source = discoverThemes(options.root).find((candidate) => candidate.id === id)
    if (source === undefined) {
      send(res, 404, 'text/plain; charset=utf-8', `no theme "${String(id)}"`)
      return
    }
    if (ext === 'css' && source.style === undefined) {
      send(res, 404, 'text/plain; charset=utf-8', `theme "${id}" has no styles.css`)
      return
    }
    const artifact = await artifactOf(options, source, ext)
    if (artifact === undefined) {
      // 转译不过去的主题没有产物：与未知 id 同样 404（原因在 manifest 的 broken 里，不在这里）。
      send(res, 404, 'text/plain; charset=utf-8', `theme "${id}" is broken; see manifest.json broken[].reason`)
      return
    }
    send(
      res,
      200,
      ext === 'css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
      artifact,
    )
  }
}

/** `webServer` 服务的最小视图（同 `SessionQueryLike` 姿态：只依赖用得到的那一个方法）。 */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** 能按名取服务、并在服务就位时跑一段回调的最小 context 视图。 */
interface ServiceContainerLike {
  get(name: string): unknown
  inject(deps: string[], callback: (ctx: ServiceContainerLike) => void): unknown
}

/**
 * 挂路由，**对插件激活顺序不敏感**。
 *
 * 为什么不是 `ctx.get('webServer')` 一次了事：本插件只 `inject: ['storageDomain']`，
 * cordis 因此**不保证** WebServer 的 provider 先于本插件激活。若它后到，`ctx.get` 拿到
 * `undefined`，一次 fire-and-forget 判断就把整条 HTTP 半边永久关掉 —— 而类型检查、构建、
 * 测试、体积全部照常是绿的，等于静默失效（浏览器侧 loader 依赖这条路由真的被挂上）。
 *
 * 这里用 cordis 的惯用写法 `ctx.inject(['webServer'], cb)`：
 * `RegistryService.inject`（`@deepseek-ai/cordis@4.0.4` 的 `lib/index.js:1600`）是
 * `this.plugin({ inject, apply: callback })` 的简写；provider 已就位时它**立刻**执行回调，
 * 否则把 fiber 停在 inactive，等 `provide()` 里的 `notify()`（`lib/index.js:832-845`）
 * 回放时再执行。声明里的 `Run a callback once the requested services are available`
 * 见 `lib/types/registry.d.ts:102-111`。
 *
 * **服务仍是可选的**：不把它塞进插件顶层的 `inject` 数组。服务始终不出现时该 fiber 一直
 * 停在 inactive —— 不抛、不阻塞、不阻止插件激活（计费照常），只是没有自定义主题。
 *
 * 返回的是 `register` 给的那个 disposer；服务还没出现就调用它，则之后的回放不再注册。
 */
export function installThemesRoute(ctx: Context, options: ThemesHandlerOptions): () => void {
  const container = ctx as unknown as ServiceContainerLike
  const handler = createThemesHandler(options)
  let registered: (() => void) | undefined
  let disposed = false
  container.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer') as WebServerLike | undefined
    // 不可达：inject 回调只在服务就位时执行。留着只是不让类型缩到 never。
    if (webServer === undefined || disposed) return
    registered = webServer.register({ kind: 'prefix', path: THEMES_ROUTE_PATH, handler })
  })
  return () => {
    disposed = true
    registered?.()
    registered = undefined
  }
}
