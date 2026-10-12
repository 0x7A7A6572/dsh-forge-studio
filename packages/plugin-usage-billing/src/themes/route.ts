/**
 * 主题路由：manifest.json 列出可转译的主题，`<id>.js` / `<id>.css` 下发产物；
 * 转不过去的主题没有产物 —— 与未知 id 一样 404，原因见 manifest 的 broken[]。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ThemeTranspiler } from './transpile.ts'
import { discoverThemes, type ThemeSource } from './discover.ts'

/** client 侧同名常量在 core/themes/manifest.ts。 */
export const THEMES_ROUTE_PATH = '/usage-billing/themes'

export interface ThemeManifestRow {
  readonly id: string
  readonly url: string
  readonly cssUrl?: string
}

/** 扫到但转译过不去；reason 直接给用户看。 */
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

/** 输入是扣掉路由前缀后的 pathname，必以 `/` 开头；id 只用白名单字符，不拼路径。 */
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
 * 一个主题一份产物。坏主题（`js()` 转不过去）整份没有产物：
 * 它的 `.css` 能转也不下发 —— 判据与 manifest 的 broken 同源。
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

interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

interface ServiceContainerLike {
  get(name: string): unknown
  inject(deps: string[], callback: (ctx: ServiceContainerLike) => void): unknown
}

/**
 * 挂路由，对插件激活顺序不敏感：webServer 后到也能挂上（故走 ctx.inject
 * 而非 ctx.get 一次性判断）；服务始终不出现则一直 inactive，不阻塞激活。
 */
export function installThemesRoute(ctx: Context, options: ThemesHandlerOptions): () => void {
  const container = ctx as unknown as ServiceContainerLike
  const handler = createThemesHandler(options)
  let registered: (() => void) | undefined
  let disposed = false
  container.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer') as WebServerLike | undefined
    // 不可达：inject 回调只在服务就位时执行，留着防类型缩到 never。
    if (webServer === undefined || disposed) return
    registered = webServer.register({ kind: 'prefix', path: THEMES_ROUTE_PATH, handler })
  })
  return () => {
    disposed = true
    registered?.()
    registered = undefined
  }
}
