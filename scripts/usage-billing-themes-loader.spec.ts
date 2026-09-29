/**
 * 装载链路的门禁。这里能跑在 node 里是因为 fetch / 插 script / 插 link 三个副作用
 * 全是参数注入的 —— 没有 DOM 也能把「清单坏了会怎样」「主题抛错会不会连坐」测干净。
 *
 * 最重要的一条：`require('react')` 拿到的必须是**宿主那一份实例**。
 * 主题用 `useState` 会挂到那个实例的调度上，拿到第二份 React 就是 hooks 直接炸。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  THEME_MANIFEST_URL,
  THEMES_ROUTE_PATH,
  parseThemeManifest,
} from '../packages/plugin-usage-billing/src/client/core/themes/manifest.ts'
import {
  THEME_HOST_KEY,
  installThemeHost,
  themeRejection,
} from '../packages/plugin-usage-billing/src/client/core/themes/theme-host.ts'
import {
  THEME_MANIFEST_FAILURE_ID,
  createThemeFailureStore,
} from '../packages/plugin-usage-billing/src/client/core/themes/failures.ts'
import type { ThemeFailureStore } from '../packages/plugin-usage-billing/src/client/core/themes/failures.ts'
import { loadThemes } from '../packages/plugin-usage-billing/src/client/core/themes/load.ts'
import { createThemeRegistry } from '../packages/plugin-usage-billing/src/client/core/theme-registry.ts'
import type { ThemeRegistryHandle } from '../packages/plugin-usage-billing/src/client/core/theme-registry.ts'
import { installThemeLoader } from '../packages/plugin-usage-billing/src/client/hooks/theme-runtime.ts'
import type { Theme } from '../packages/plugin-usage-billing/src/shape/index.ts'

/**
 * `theme-runtime.ts` 在模块作用域 import 这份 UI 原子包，而它**只能在浏览器里**加载：上游把
 * `clsx` / `shiki` 这些运行时依赖声明成了 devDependency，产物里那句 `import 'clsx'` 在 node 里
 * 根本没有可解析目标（浏览器侧它来自宿主模块表）。下面的用例只借装载器这个函数，不碰那个实例，
 * 所以给个空壳。
 *
 * 路径必须写成 node_modules 里的**相对路径**而不是裸包名：仓库根不依赖这个包，裸名字从 `scripts/`
 * 解析不出 id，vi.mock 会挂在一个对不上的键上，等于没 mock（实测，详见 theme-contract.spec.ts）。
 */
vi.mock(
  '../packages/plugin-usage-billing/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js',
  () => ({}),
)

const MANIFEST = {
  themes: [
    { id: 'line', url: '/usage-billing/themes/line.js', cssUrl: '/usage-billing/themes/line.css' },
    { id: 'plain', url: '/usage-billing/themes/plain.js' },
  ],
  broken: [{ id: 'bad', reason: '主题只能 import react，收到 "lodash"' }],
}

describe('manifest 校验', () => {
  it('合法清单原样通过', () => {
    expect(parseThemeManifest(MANIFEST).themes.map((t) => t.id)).toEqual(['line', 'plain'])
  })

  it('不是对象 / themes 不是数组就抛，且说清是哪里不对', () => {
    expect(() => parseThemeManifest(null)).toThrow(/清单/)
    expect(() => parseThemeManifest({ themes: {} })).toThrow(/themes/)
  })

  it('少 url 的行被丢掉（宁可少一个主题，也不要装载时炸）', () => {
    expect(parseThemeManifest({ themes: [{ id: 'x' }], broken: [] }).themes).toEqual([])
  })
})

describe('主题自报的校验', () => {
  it('label 非空字符串 + component 是函数才算数', () => {
    expect(themeRejection({ label: 'x', component: () => null })).toBeUndefined()
    expect(themeRejection({ label: '', component: () => null })).toMatch(/label/)
    expect(themeRejection({ label: 'x', component: 1 })).toMatch(/component/)
    expect(themeRejection(undefined)).toMatch(/theme/)
  })
})

describe('装载', () => {
  // 主题只有一条到达路径：浏览器执行产物 → 产物自调 define → 宿主的 onTheme。
  // loadThemes 自己不"交付"主题，它只负责把脚本插进去 —— 所以这里必须装一个真宿主。
  function mountHost(themes: Theme[], store: ThemeFailureStore): Record<string, unknown> {
    const target: Record<string, unknown> = {}
    installThemeHost({
      target,
      modules: { react: { useState: () => [0, () => {}] } },
      onTheme: (theme) => themes.push(theme),
      onRejection: (id, reason) => store.add({ id, reason }),
    })
    return target
  }

  /** 模拟浏览器执行产物：产物末尾自调 define，id 由路由写死（主题改不了）。 */
  function defining(
    target: Record<string, unknown>,
    idOf: (url: string) => string,
  ): (url: string) => Promise<void> {
    return async (url) => {
      const id = idOf(url)
      const host = target.__usageBillingThemeHost as { define(id: string, theme: unknown): void }
      host.define(id, { label: `来自 ${id}`, component: () => null })
    }
  }

  /**
   * 与 `theme-runtime.ts` 同构的落地判定：注册成功，**或者**已经被拒（那种情况失败 store 里
   * 有一条更具体的原因）。装载器的后置检查靠它区分「脚本跑了但没着落」与「给了具体原因」。
   */
  function landedIn(themes: Theme[], store: ThemeFailureStore): (id: string) => boolean {
    return (id) =>
      themes.some((theme) => theme.id === id) || store.list().some((failure) => failure.id === id)
  }

  it('主题自报成功后进集合，label 来自主题自己', async () => {
    const themes: Theme[] = []
    const store = createThemeFailureStore()
    const target = mountHost(themes, store)
    await loadThemes({
      fetchJson: async () => MANIFEST,
      loadScript: defining(target, (url) => (url.includes('line') ? 'line' : 'plain')),
      loadStyle: () => {},
      reject: (id, reason) => store.add({ id, reason }),
      hasLanded: landedIn(themes, store),
    })
    expect(themes.map((theme) => theme.id)).toEqual(['line', 'plain'])
    expect(themes[0]?.label).toBe('来自 line')
    // 宿主在 manifest 里报的那条 broken 也进了失败列表（它根本没被下发脚本）。
    expect(store.list()).toEqual([{ id: 'bad', reason: '主题只能 import react，收到 "lodash"' }])
  })

  it('脚本执行成功却没注册主题 → 记一条可读原因（经典脚本顶层抛错走的是 onload，不是 onerror）', async () => {
    const themes: Theme[] = []
    const store = createThemeFailureStore()
    const target = mountHost(themes, store)
    const define = defining(target, () => 'plain')
    await loadThemes({
      fetchJson: async () => MANIFEST,
      // line 的产物在顶层就抛了（比如用了一个宿主没提供的全局）：onload 照常 resolve，
      // 于是「脚本跑完了但 registry 里没有它」是唯一能看见这件事的地方。
      loadScript: async (url) => {
        if (!url.includes('line')) await define(url)
      },
      loadStyle: () => {},
      reject: (id, reason) => store.add({ id, reason }),
      hasLanded: landedIn(themes, store),
    })
    // 健康的那个照常注册，且**没有**被连坐记失败。
    expect(themes.map((theme) => theme.id)).toEqual(['plain'])
    const line = store.list().find((failure) => failure.id === 'line')
    expect(line).toBeDefined()
    expect(line?.reason).toBeTruthy()
    // 原因要能被用户读懂，并把他指向真正的错误现场（控制台）。
    expect(line?.reason).toContain('line')
    expect(line?.reason).toContain('控制台')
    expect(store.list().map((failure) => failure.id).sort()).toEqual(['bad', 'line'])
  })

  it('脚本加载失败与「跑了没注册」不互相盖掉（各自保留更具体的那条原因）', async () => {
    const themes: Theme[] = []
    const store = createThemeFailureStore()
    const target = mountHost(themes, store)
    // plain 的产物调了 define，但自报的 theme 不合法（没有 label）→ 宿主走 onRejection。
    // 它同样没进 registry；后置检查不许用通用原因把这条具体原因盖掉。
    const badPayload = async (): Promise<void> => {
      const host = target.__usageBillingThemeHost as { define(id: string, theme: unknown): void }
      host.define('plain', { component: () => null })
    }
    await loadThemes({
      fetchJson: async () => MANIFEST,
      loadScript: async (url) => {
        if (url.includes('line')) throw new Error('HTTP 500')
        await badPayload()
      },
      loadStyle: () => {},
      reject: (id, reason) => store.add({ id, reason }),
      hasLanded: landedIn(themes, store),
    })
    expect(store.list().find((failure) => failure.id === 'line')?.reason).toContain('HTTP 500')
    expect(store.list().find((failure) => failure.id === 'plain')?.reason).toContain('label')
  })

  it('一个主题的脚本加载失败不连坐后面的', async () => {
    const themes: Theme[] = []
    const store = createThemeFailureStore()
    const target = mountHost(themes, store)
    const define = defining(target, () => 'plain')
    await loadThemes({
      fetchJson: async () => MANIFEST,
      loadScript: async (url) => {
        if (url.includes('line')) throw new Error('HTTP 500')
        await define(url)
      },
      loadStyle: () => {},
      reject: (id, reason) => store.add({ id, reason }),
      hasLanded: landedIn(themes, store),
    })
    expect(themes.map((theme) => theme.id)).toEqual(['plain'])
    expect(store.list().map((failure) => failure.id).sort()).toEqual(['bad', 'line'])
    expect(store.list().find((failure) => failure.id === 'line')?.reason).toContain('HTTP 500')
  })

  it('清单拉不到只记一条失败，不抛', async () => {
    const store = createThemeFailureStore()
    await loadThemes({
      fetchJson: async () => { throw new Error('404') },
      loadScript: async () => {},
      loadStyle: () => {},
      reject: (id, reason) => store.add({ id, reason }),
      // 清单都没拉到 → 主题那一轮一行都没走，这个判定不该被调用；真被调用就会多出一条失败，
      // 下面 `toHaveLength(1)` 立刻红。
      hasLanded: () => false,
    })
    expect(store.list()).toHaveLength(1)
    // 先钉字面量再比：哨兵 id 若在两边都是 undefined（典型的错 import），
    // 下面那条 `toBe(THEME_MANIFEST_FAILURE_ID)` 会**假绿** —— 这条让它真绿。
    expect(THEME_MANIFEST_FAILURE_ID).toBe('(manifest)')
    expect(store.list()[0]?.id).toBe(THEME_MANIFEST_FAILURE_ID)
    expect(store.list()[0]?.reason).toContain('404')
  })

  it('带 cssUrl 的主题会插一条样式', async () => {
    const styled: string[] = []
    await loadThemes({
      fetchJson: async () => MANIFEST,
      loadScript: async () => {},
      loadStyle: (url) => styled.push(url),
      reject: () => {},
      // 本用例只查插样式：脚本没注册也不是这里的断言对象，所以当作两个 id 都已落地。
      hasLanded: () => true,
    })
    expect(styled).toEqual(['/usage-billing/themes/line.css'])
  })

  it('样式插不进去不连坐：两个主题照常装载，也不为样式记一行失败', async () => {
    const themes: Theme[] = []
    const store = createThemeFailureStore()
    const target = mountHost(themes, store)
    await loadThemes({
      fetchJson: async () => MANIFEST,
      loadScript: defining(target, (url) => (url.includes('line') ? 'line' : 'plain')),
      // 样式插不进去（head 没有、document 已卸载之类）：它是一段同步代码，抛出来会带走整个循环 ——
      // line 会凭空消失，plain 连试都不会试，列表里只剩一条「清单读取失败」的假象。
      loadStyle: (url) => {
        if (url.includes('line')) throw new Error('head 不存在')
      },
      reject: (id, reason) => store.add({ id, reason }),
      hasLanded: landedIn(themes, store),
    })
    // 两个主题都装上了：样式失败既不撤掉 line，也不挡住后面的 plain。
    expect(themes.map((theme) => theme.id)).toEqual(['line', 'plain'])
    // 而且**没有**为样式多写一行（主题仍然可选，多一行只是噪音）：列表里只有宿主报的那条 broken。
    expect(store.list()).toEqual([{ id: 'bad', reason: '主题只能 import react，收到 "lodash"' }])
  })

  it('require 表里没有的模块抛错并说清允许什么', () => {
    const target: Record<string, unknown> = {}
    installThemeHost({ target, modules: { react: {} }, onTheme: () => {}, onRejection: () => {} })
    const host = target.__usageBillingThemeHost as { require(specifier: string): unknown }
    expect(() => host.require('lodash')).toThrow(/lodash/)
    expect(host.require('react')).toEqual({})
  })

  it('失败列表按 id 去重（重复装载不会堆日志）', () => {
    const store = createThemeFailureStore()
    store.add({ id: 'x', reason: 'a' })
    store.add({ id: 'x', reason: 'b' })
    expect(store.list()).toEqual([{ id: 'x', reason: 'b' }])
  })

  it('订阅能收到变化', () => {
    const store = createThemeFailureStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.add({ id: 'x', reason: 'a' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('clear 撤掉一条失败并通知订阅者；撤不存在的 id 时连通知都不发', () => {
    const store = createThemeFailureStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.add({ id: 'x', reason: 'a' })
    expect(listener).toHaveBeenCalledTimes(1)
    store.clear('x')
    expect(store.list()).toEqual([])
    // 撤掉也是一次变化：不通知，订阅的界面会一直显示一条已经不成立的失败。
    expect(listener).toHaveBeenCalledTimes(2)
    // 空清一次不叫醒订阅者（那是一次白渲染），也不换快照引用（useSyncExternalStore 会当场重渲染）。
    store.clear('x')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('dispose 会把订阅者叫醒一次（列表变空也是变化）', () => {
    const store = createThemeFailureStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.add({ id: 'x', reason: 'a' })
    store.dispose()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.list()).toEqual([])
  })
})

describe('installThemeLoader（真实接线：宿主 + 清单 + 插 script/link + 失败 store）', () => {
  type ScriptOutcome = 'ran' | 'load-error'

  interface FakeScriptElement {
    src: string
    async: boolean
    onload: (() => void) | null
    onerror: (() => void) | null
    remove(): void
  }

  interface FakeLinkElement {
    rel: string
    href: string
    remove(): void
  }

  interface FakeBrowser {
    readonly document: Document
    readonly fetchImpl: typeof fetch
    /** 插进去过（含已被摘掉）的脚本 src，按顺序。 */
    readonly scriptUrls: string[]
    /** 插进去过的样式 href，按顺序。 */
    readonly styleUrls: string[]
    readonly fetchCalls: { url: string; accept: string | undefined }[]
    readonly removedCount: () => number
  }

  /**
   * 假浏览器：`document` 只会 createElement / head.append / remove，`fetch` 只回清单 JSON。
   *
   * 「脚本执行」在真浏览器里由 `<script>` 的执行器完成，这里交给用例的 `execute` —— 它是唯一能把
   * 这三件事分开的地方：「产物真调到了宿主全局」「顶层抛错（onload 照常触发）」「加载失败（onerror）」。
   * 上面那个 describe 是拿 `loadThemes` 的参数直接模拟副作用；这里走的是 `theme-runtime.ts` 里
   * 真正的 `injectScript` / `injectStyle` / fetch 适配器 / 落地账本。
   */
  function createFakeBrowser(options: {
    readonly manifest: unknown
    readonly manifestStatus?: number
    readonly execute: (url: string) => ScriptOutcome
  }): FakeBrowser {
    const kinds = new WeakMap<FakeScriptElement | FakeLinkElement, 'script' | 'link'>()
    const scriptUrls: string[] = []
    const styleUrls: string[] = []
    const fetchCalls: { url: string; accept: string | undefined }[] = []
    let removed = 0

    const document = {
      createElement(tag: string): FakeScriptElement | FakeLinkElement {
        if (tag === 'script') {
          const element: FakeScriptElement = {
            src: '', async: true, onload: null, onerror: null,
            remove: () => { removed += 1 },
          }
          kinds.set(element, 'script')
          return element
        }
        const element: FakeLinkElement = { rel: '', href: '', remove: () => { removed += 1 } }
        kinds.set(element, 'link')
        return element
      },
      head: {
        append(element: FakeScriptElement | FakeLinkElement) {
          if (kinds.get(element) === 'script') {
            const script = element as FakeScriptElement
            scriptUrls.push(script.src)
            if (options.execute(script.src) === 'load-error') {
              script.onerror?.()
              return
            }
            // 跑完了、和「执行期顶层抛错」，在浏览器里**都**走 onload —— 这正是后置检查存在的理由。
            script.onload?.()
            return
          }
          styleUrls.push((element as FakeLinkElement).href)
        },
      },
    }

    const fetchImpl = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input)
      fetchCalls.push({ url, accept: init?.headers?.accept })
      const status = options.manifestStatus ?? 200
      if (status !== 200) return { ok: false, status, json: async () => ({}) }
      return { ok: true, status, json: async () => options.manifest }
    }) as unknown as typeof fetch

    return {
      document: document as unknown as Document,
      fetchImpl,
      scriptUrls,
      styleUrls,
      fetchCalls,
      removedCount: () => removed,
    }
  }

  /** 假副作用全走微任务，一个宏任务边界就够跑完整条装载链（多等一轮更稳）。 */
  async function settle(): Promise<void> {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }

  /** 产物末尾那句自调：`globalThis.__usageBillingThemeHost.define(id, module.exports.theme)`。 */
  function defineOn(target: Record<string, unknown>, id: string, theme: unknown): void {
    const host = target[THEME_HOST_KEY] as { define(id: string, theme: unknown): void }
    host.define(id, theme)
  }

  interface Harness {
    readonly target: Record<string, unknown>
    readonly registry: ThemeRegistryHandle
    readonly failures: ThemeFailureStore
    readonly browser: FakeBrowser
    readonly dispose: () => void
  }

  function mount(options: {
    readonly manifest: unknown
    readonly manifestStatus?: number
    readonly run: (url: string, target: Record<string, unknown>) => ScriptOutcome
    readonly registry?: ThemeRegistryHandle
    readonly failures?: ThemeFailureStore
  }): Harness {
    const target: Record<string, unknown> = {}
    const registry = options.registry ?? createThemeRegistry()
    const failures = options.failures ?? createThemeFailureStore()
    const browser = createFakeBrowser({
      manifest: options.manifest,
      manifestStatus: options.manifestStatus,
      execute: (url) => options.run(url, target),
    })
    const dispose = installThemeLoader({
      registry,
      failures,
      document: browser.document,
      fetchImpl: browser.fetchImpl,
      target,
    })
    return { target, registry, failures, browser, dispose }
  }

  const healthyRun = (url: string, target: Record<string, unknown>): ScriptOutcome => {
    const id = url.includes('line') ? 'line' : 'plain'
    defineOn(target, id, { label: `来自 ${id}`, component: () => null })
    return 'ran'
  }

  it('健康主题：产物自调 define → 进 registry、样式插上、除宿主报的 broken 外一行失败都没有', async () => {
    const harness = mount({ manifest: MANIFEST, run: healthyRun })
    await settle()
    expect(harness.registry.list().map((theme) => theme.id)).toEqual(['line', 'plain'])
    expect(harness.registry.list()[0]?.label).toBe('来自 line')
    expect(harness.browser.styleUrls).toEqual(['/usage-billing/themes/line.css'])
    expect(harness.browser.scriptUrls).toEqual([
      '/usage-billing/themes/line.js',
      '/usage-billing/themes/plain.js',
    ])
    // 真实 fetch 适配器：拉的就是清单 URL，且带了 accept 头。
    expect(harness.browser.fetchCalls).toEqual([
      { url: THEME_MANIFEST_URL, accept: 'application/json' },
    ])
    expect(harness.failures.list()).toEqual([
      { id: 'bad', reason: '主题只能 import react，收到 "lodash"' },
    ])
    harness.dispose()
  })

  it('产物跑完却没 define → 通用后置失败（经典脚本顶层抛错走的是 onload，不是 onerror）', async () => {
    // 顶层抛错的产物：`execute` 什么也没调就返回 'ran'，而浏览器照常触发 onload。
    const harness = mount({ manifest: MANIFEST, run: () => 'ran' })
    await settle()
    expect(harness.registry.list()).toEqual([])
    const line = harness.failures.list().find((failure) => failure.id === 'line')
    expect(line?.reason).toContain('没有注册主题')
    expect(line?.reason).toContain('控制台')
    expect(harness.failures.list().map((failure) => failure.id).sort()).toEqual(['bad', 'line', 'plain'])
    harness.dispose()
  })

  it('define 给的具体原因不会被通用原因盖掉（生产接线的落地账本就护这条）', async () => {
    const harness = mount({
      manifest: MANIFEST,
      run: (url, target) => {
        if (url.includes('plain')) {
          // 自报的 theme 不合法（没有 label）→ 宿主走 onRejection；它同样没进 registry。
          defineOn(target, 'plain', { component: () => null })
          return 'ran'
        }
        defineOn(target, 'line', { label: 'line', component: () => null })
        return 'ran'
      },
    })
    await settle()
    expect(harness.registry.list().map((theme) => theme.id)).toEqual(['line'])
    const plain = harness.failures.list().find((failure) => failure.id === 'plain')
    expect(plain?.reason).toContain('label')
    // 关键断言（删掉 `theme-runtime.ts` 里 `onRejection` 的 `landed.add(id)` 就会红）：被拒的主题
    // 同样不在 registry 里，账本若不算它落地，后置检查就会往同一个 id 再写一条通用原因 ——
    // 失败 store 按 id 去重、后写的顶掉先写的，用户看到的原因就从「label 不合法」变成「没注册」。
    expect(plain?.reason).not.toContain('没有注册主题')
    harness.dispose()
  })

  it('脚本加载失败 → 保留 onerror 那条原因，也不被通用原因盖掉', async () => {
    const harness = mount({ manifest: MANIFEST, run: () => 'load-error' })
    await settle()
    const line = harness.failures.list().find((failure) => failure.id === 'line')
    expect(line?.reason).toContain('脚本加载失败')
    expect(line?.reason).not.toContain('没有注册主题')
    harness.dispose()
  })

  it('清单拿不到 HTTP 404 → 一条 (manifest) 失败，原因里带真实适配器给的码', async () => {
    const harness = mount({ manifest: {}, manifestStatus: 404, run: () => 'ran' })
    await settle()
    expect(harness.browser.scriptUrls).toEqual([])
    expect(harness.failures.list()).toEqual([
      { id: THEME_MANIFEST_FAILURE_ID, reason: '主题清单读取失败：HTTP 404' },
    ])
    harness.dispose()
  })

  it('用的是传进来的 document，而不是全局 document（node 里没有全局 document）', async () => {
    // 两套假 document 各自记账：插错地方一眼看得出来。修前 `injectScript` 闭包读的是全局
    // `document`（参数只用来判空），在 node 里这一步直接 ReferenceError。
    const first = mount({ manifest: MANIFEST, run: healthyRun })
    const second = mount({
      manifest: { themes: [{ id: 'other', url: '/usage-billing/themes/other.js' }], broken: [] },
      run: (url, target) => {
        defineOn(target, 'other', { label: 'other', component: () => null })
        return 'ran'
      },
    })
    await settle()
    expect(first.browser.scriptUrls).toEqual([
      '/usage-billing/themes/line.js',
      '/usage-billing/themes/plain.js',
    ])
    expect(second.browser.scriptUrls).toEqual(['/usage-billing/themes/other.js'])
    expect(second.registry.list().map((theme) => theme.id)).toEqual(['other'])
    first.dispose()
    second.dispose()
  })

  it('卸载：摘掉插进去的节点，迟到的 define 是无害的 no-op', async () => {
    const harness = mount({ manifest: MANIFEST, run: () => 'ran' })
    await settle()
    expect(harness.browser.scriptUrls).toHaveLength(2)
    const before = harness.failures.list()
    harness.dispose()
    // 2 段脚本 + 1 条样式，全部从 document 里摘掉（对还在飞的脚本，摘下来本身就是取消执行）。
    expect(harness.browser.removedCount()).toBe(3)
    // 清理函数可能被 effect 清理重复调用：第二次是空操作。
    harness.dispose()
    expect(harness.browser.removedCount()).toBe(3)
    // 还在飞的产物末尾会**无保护**地调 define：修前全局键已被卸载删掉，这句就是 `undefined.define`
    // 的 TypeError（只在控制台里，用户看不到也查不到）。修后它是一次无声的 no-op。
    expect(() => {
      defineOn(harness.target, 'late', { label: '迟到', component: () => null })
    }).not.toThrow()
    expect(harness.registry.list()).toEqual([])
    expect(harness.failures.list()).toEqual(before)
  })

  it('同一个 id 后来装成功了，先前那条失败会被撤掉（同一次会话、同一个 store）', async () => {
    const registry = createThemeRegistry()
    const failures = createThemeFailureStore()
    // 第一次装载：产物跑了但没 define → line / plain 各一条通用失败。
    const first = mount({ manifest: MANIFEST, run: () => 'ran', registry, failures })
    await settle()
    expect(failures.list().map((failure) => failure.id)).toEqual(['bad', 'line', 'plain'])
    first.dispose()
    // 第二次装载：这次真的注册上了 → 那两条失败已经过期，必须撤掉（否则设置页会指着一个能用的
    // 主题说它没生效）。
    const second = mount({ manifest: MANIFEST, run: healthyRun, registry, failures })
    await settle()
    expect(registry.list().map((theme) => theme.id)).toEqual(['line', 'plain'])
    expect(failures.list().map((failure) => failure.id)).toEqual(['bad'])
    second.dispose()
  })

  it('没有 document 就什么都不做（SSR / node 里不炸）', () => {
    const registry = createThemeRegistry()
    const failures = createThemeFailureStore()
    const dispose = installThemeLoader({ registry, failures, target: {} })
    expect(() => { dispose() }).not.toThrow()
    expect(registry.list()).toEqual([])
    expect(failures.list()).toEqual([])
  })
})

describe('跨端常量', () => {
  it('客户端清单 URL 与 host 路由前缀一致（两处硬编码不许漂）', async () => {
    // 动态 import：host 侧模块会拉起 esbuild，放在文件顶部会让整个 spec 文件都依赖它。
    const host = await import('../packages/plugin-usage-billing/src/themes/route.ts')
    expect(THEMES_ROUTE_PATH).toBe(host.THEMES_ROUTE_PATH)
    expect(THEME_MANIFEST_URL).toBe(`${THEMES_ROUTE_PATH}/manifest.json`)
  })

  it('宿主挂的那个全局名与产物自调的那个一致（漂了=每个主题都静默不生效）', async () => {
    const host = await import('../packages/plugin-usage-billing/src/themes/transpile.ts')
    expect(THEME_HOST_KEY).toBe(host.THEME_HOST_GLOBAL)
  })
})
