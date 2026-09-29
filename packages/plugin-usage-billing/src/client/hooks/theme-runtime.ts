/**
 * 主题运行时：**唯一** import react 的装载侧文件（见 spec 的例外说明）。
 *
 * 它做三件事：
 * 1. 用**宿主自己 import 到的那份实例**组装 require 表 —— 主题里的 `useState` 必须挂到
 *    同一个 React 调度上，否则 hooks 直接炸；契约同理（`toneAtMinute` 字面同一份函数）。
 * 2. 把宿主挂到 `globalThis.__usageBillingThemeHost`（host 侧产物末尾会自调它的 `define`）。
 * 3. 用 fetch + `<script>` + `<link>` 把清单里的主题装进来，失败记进失败 store。
 *
 * 刷新页面就重来一遍：没有 watch、没有 SSE（spec 的非目标）。
 */
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as contract from '../../shape/index.ts'
import { SHAPE_SPECIFIER } from '../../shape/index.ts'
import { THEME_MANIFEST_URL } from '../core/themes/manifest.ts'
import { THEME_MANIFEST_FAILURE_ID } from '../core/themes/failures.ts'
import { installThemeHost } from '../core/themes/theme-host.ts'
import { loadThemes } from '../core/themes/load.ts'
import type { ThemeFailureStore } from '../core/themes/failures.ts'
import type { ThemeRegistry } from '../core/theme-registry.ts'

/**
 * 主题能 require 到的模块。**键必须覆盖契约里的 `THEME_ALLOWED_MODULES`**
 * （`scripts/theme-contract.spec.ts` 钉这条）。
 */
export const THEME_MODULE_MAP: Readonly<Record<string, unknown>> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
  [SHAPE_SPECIFIER]: contract,
}

/**
 * 往 document 里插一段经典脚本并等它执行完（`async = false` 保住清单顺序）。
 *
 * `injected` 是卸载时要带走的那份账：插进去的节点不记下来，卸载之后就再也找不回来了。
 */
function injectScript(doc: Document, injected: Set<Element>): (url: string) => Promise<void> {
  return (url) => new Promise((resolve, reject) => {
    const element = doc.createElement('script')
    element.src = url
    element.async = false
    element.onload = () => { resolve() }
    element.onerror = () => { reject(new Error(`脚本加载失败（HTTP 错误或产物语法错）：${url}`)) }
    injected.add(element)
    doc.head.append(element)
  })
}

/** 往 document 里插一条主题样式表。 */
function injectStyle(doc: Document, injected: Set<Element>): (url: string) => void {
  return (url) => {
    const element = doc.createElement('link')
    element.rel = 'stylesheet'
    element.href = url
    injected.add(element)
    doc.head.append(element)
  }
}

export interface InstallThemeLoaderOptions {
  readonly registry: ThemeRegistry
  readonly failures: ThemeFailureStore
  /** 测试与 SSR 用；缺省 `globalThis.document` / `globalThis.fetch`。 */
  readonly document?: Document
  readonly fetchImpl?: typeof fetch
  readonly target?: Record<string, unknown>
}

/**
 * 装宿主并起一次装载。返回卸载函数（挂载方把它交给 `ctx.effect`）。
 *
 * 内置主题不在清单里 —— 它在 bundle 里，由调用方先注册进 registry。
 */
export function installThemeLoader(options: InstallThemeLoaderOptions): () => void {
  const target = options.target ?? (globalThis as unknown as Record<string, unknown>)
  const doc = options.document ?? globalThis.document
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (doc === undefined || doFetch === undefined) return () => {}

  /**
   * 「这个 id 已经有下落了」：注册成功，或者 `define` 被拒。装载器拿它当**后置检查**用 ——
   * 经典脚本顶层抛错时 `onload` 照常触发，注册与否只能靠这份账本来判。
   */
  const landed = new Set<string>()
  /** 已经插进 document 的节点（卸载时要一起摘掉，见下面 disposer）。 */
  const injected = new Set<Element>()
  /** 已经卸载。迟到的产物调进来时靠它变成 no-op（见下面 disposer 的说明）。 */
  let closed = false

  // 卸载时刻意**不**调用 `installThemeHost` 返回的那个 disposer（它会把全局键删掉）：还在飞的
  // 产物末尾会**无保护**地读 `globalThis.__usageBillingThemeHost.define(...)`（见 host 侧
  // `themes/transpile.ts` 的 `wrapTheme`）。键一消失，那就是 `undefined.define` 的 TypeError ——
  // 只落在控制台里，用户看不到、也没法查。留着这个「已经关掉」的宿主，迟到的调用就是一次无声的
  // no-op；代价是那个全局名要等下一次 `installThemeLoader`（或页面刷新）才被顶掉。
  installThemeHost({
    target,
    modules: THEME_MODULE_MAP,
    onTheme: (theme) => {
      if (closed) return
      landed.add(theme.id)
      // 这一次真的注册上了：同一个 id 先前那条失败（上一轮装载留下的）已经过期，撤掉它，
      // 否则设置页会指着一个能用的主题说它没生效。
      options.failures.clear(theme.id)
      options.registry.register(theme)
    },
    onRejection: (id, reason) => {
      if (closed) return
      // 被拒也算「有下落」：它没进 registry，但失败名单里那条原因比装载器的通用原因具体。
      landed.add(id)
      options.failures.add({ id, reason })
    },
  })

  void loadThemes({
    manifestUrl: THEME_MANIFEST_URL,
    fetchJson: async (url) => {
      const response = await doFetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const manifest: unknown = await response.json()
      // 清单这一次读到了：上一条 `(manifest)` 失败（例如上一轮装的时候宿主还没起好）已经过期。
      options.failures.clear(THEME_MANIFEST_FAILURE_ID)
      return manifest
    },
    loadScript: injectScript(doc, injected),
    loadStyle: injectStyle(doc, injected),
    reject: (id, reason) => { options.failures.add({ id, reason }) },
    hasLanded: (id) => landed.has(id),
  }).catch((error: unknown) => {
    options.failures.add({
      id: THEME_MANIFEST_FAILURE_ID,
      reason: `主题装载异常：${error instanceof Error ? error.message : String(error)}`,
    })
  })

  return () => {
    closed = true
    // 摘掉自己插进去的每一个节点：留着它们，一段还没执行的脚本会在宿主拆掉之后跑起来。
    // （对已经跑完的节点这只是打扫卫生；对还在飞的节点，摘下来本身就等于取消执行。）
    for (const element of injected) element.remove()
    injected.clear()
    // 账本随宿主一起清：卸载之后再没有「落地判定」这回事了，留着只是一份指向已拆宿主的 id 集合。
    landed.clear()
  }
}
