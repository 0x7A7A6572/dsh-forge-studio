/**
 * Agent Studio 设置页「刷新」按钮的回归契约（第二轮）。
 *
 * 三层互相补位：
 * - 渲染：把 useAgentStudioSettings 打桩，直接调用组件函数拿元素树，再用 react-dom/server
 *   渲染字符串，钉住按钮属性、disabled / aria-disabled / aria-busy 的归属、图标与 spin 类、
 *   role="status" 的播报文本、以及错误条与空态的互斥。
 * - 行为：用 TypeScript 编译器 API 把 hook 源码转成 CommonJS，在假 React 上执行，
 *   验证 reload 的 error 清理、失败复位、useRef 防重入、返回值，以及 fetchSeq 代次回归。
 * - 静态：CSS Modules 文本 + StudioIcon / JSX 的 AST 契约。
 *
 * 局限：hook 行为测试靠「源码 transpile + 假 React」，不走真实 React 调度；
 * useEffect 是 no-op，所以并发用「reload → removeProfile 触发的 run/refresh」造两个代次。
 * 组件运行时测试永远 import 真实源文件；AGENT_STUDIO_SRC_ROOT 只重定向「读文本」这一层，
 * 供变异验证使用（临时副本），不影响正常运行。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { errorText, unwrap } from '../packages/plugin-agent-studio/src/client/core/result.ts'
import { StudioIcon } from '../packages/plugin-agent-studio/src/client/components/StudioIcon.tsx'
import { AgentStudioSettings } from '../packages/plugin-agent-studio/src/client/views/settings-section/AgentStudioSettings.tsx'
import styles from '../packages/plugin-agent-studio/src/client/views/settings-section/AgentStudioSettings.module.css'

const SOURCE_ROOT = process.env.AGENT_STUDIO_SRC_ROOT === undefined || process.env.AGENT_STUDIO_SRC_ROOT === ''
  ? fileURLToPath(new URL('../packages/plugin-agent-studio/src/client', import.meta.url))
  : resolvePath(process.env.AGENT_STUDIO_SRC_ROOT)
const SETTINGS_TSX = join(SOURCE_ROOT, 'views/settings-section/AgentStudioSettings.tsx')
const HOOK_TS = join(SOURCE_ROOT, 'views/settings-section/useAgentStudioSettings.ts')
const CSS_FILE = join(SOURCE_ROOT, 'views/settings-section/AgentStudioSettings.module.css')
const STUDIO_ICON_TSX = join(SOURCE_ROOT, 'components/StudioIcon.tsx')

const pkgRequire = createRequire(new URL('../packages/plugin-agent-studio/package.json', import.meta.url))
const reactRuntime = pkgRequire('react') as {
  createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => any
  isValidElement: (value: unknown) => boolean
}
const serverRuntime = pkgRequire('react-dom/server') as {
  renderToStaticMarkup: (element: unknown) => string
}

/* ---------- 打桩 hook，供组件渲染 ---------- */

const hookMock = vi.hoisted(() => ({ state: {} as Record<string, any> }))
vi.mock(
  '../packages/plugin-agent-studio/src/client/views/settings-section/useAgentStudioSettings.ts',
  () => ({ useAgentStudioSettings: () => hookMock.state }),
)

function profile(id: string, displayName: string): Record<string, unknown> {
  return {
    id,
    name: id,
    displayName,
    description: '',
    rolePrompt: '',
    model: null,
    context: 'fresh',
    maxDepth: 1,
    avatarSeed: 'default',
    createdAt: 0,
    updatedAt: 0,
  }
}

/** 与第二轮 hook 返回值一致：不再暴露 refresh。 */
function hookState(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    tab: 'profiles',
    setTab: () => {},
    profiles: [],
    teams: [],
    models: [],
    presets: [],
    busy: false,
    reloading: false,
    error: '',
    profileDraft: null,
    setProfileDraft: () => {},
    teamDraft: null,
    setTeamDraft: () => {},
    memberPickId: '',
    setMemberPickId: () => {},
    availableProfiles: [],
    addSelectedMember: () => {},
    reload: async () => {},
    saveProfile: () => {},
    removeProfile: () => {},
    saveTeam: () => {},
    removeTeam: () => {},
    addMember: () => {},
    removeMember: () => {},
    newProfile: () => {},
    newTeam: () => {},
    closeEditors: () => {},
    ...overrides,
  }
}

function findElement(node: any, predicate: (element: any) => boolean): any {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, predicate)
      if (hit !== null) return hit
    }
    return null
  }
  if (!reactRuntime.isValidElement(node)) return null
  if (predicate(node)) return node
  return findElement(node.props?.children, predicate)
}

function settingsTree(overrides: Record<string, any> = {}): any {
  hookMock.state = hookState(overrides)
  return (AgentStudioSettings as any)({ studio: {} })
}

function renderSettings(overrides: Record<string, any> = {}): string {
  hookMock.state = hookState(overrides)
  return serverRuntime.renderToStaticMarkup(
    reactRuntime.createElement(AgentStudioSettings as any, { studio: {} }),
  )
}

function reloadButton(overrides: Record<string, any> = {}): any {
  const button = findElement(
    settingsTree(overrides),
    element => element.type === 'button' && element.props['data-dsh-action'] === 'reload',
  )
  if (button === null) throw new Error('渲染树里没有 data-dsh-action="reload" 的刷新按钮')
  return button
}

function refreshIcon(button: any): any {
  const icon = findElement(button.props.children, element => element.type === StudioIcon)
  if (icon === null) throw new Error('刷新按钮里没有 StudioIcon')
  return icon
}

function statusNode(overrides: Record<string, any> = {}): any {
  const node = findElement(
    settingsTree(overrides),
    element => element.type === 'span' && element.props.role === 'status',
  )
  if (node === null) throw new Error('渲染树里没有 role="status" 的刷新状态区')
  return node
}

function reloadButtonHtml(html: string): string {
  const match = html.match(/<button[^>]*data-dsh-action="reload"[\s\S]*?<\/button>/)
  if (match === null) throw new Error('服务端 HTML 里找不到刷新按钮')
  return match[0]
}

function statusHtml(html: string): string {
  const match = html.match(/<span[^>]*role="status"[^>]*>([\s\S]*?)<\/span>/)
  if (match === null) throw new Error('服务端 HTML 里找不到 role="status" 的刷新状态区')
  return match[1] ?? ''
}

describe('刷新按钮（渲染契约）', () => {
  it('idle：可点击、aria-disabled 不渲染、状态区存在但为空', () => {
    const reload = vi.fn(async () => {})
    const button = reloadButton({ reload })

    expect(button.props.type).toBe('button')
    expect(button.props['aria-label']).toBe('刷新')
    expect(button.props.title).toBe('刷新（重新读取智能体 / 团队 / 模型 / preset）')
    expect(button.props['data-dsh-action']).toBe('reload')
    expect(button.props.disabled).toBe(false)
    expect(button.props['aria-disabled']).toBeUndefined()
    expect(button.props['aria-busy']).toBe(false)

    button.props.onClick()
    expect(reload).toHaveBeenCalledTimes(1)

    const icon = refreshIcon(button)
    expect(icon.props.name).toBe('refresh')
    expect(icon.props.className).toBeUndefined()

    const status = statusNode()
    expect(status.props.className).toBe(styles.srOnly)
    expect(status.props.children).toBe('')
  })

  it('reloading：不禁用，aria-disabled + aria-busy，图标转、状态区播报', () => {
    const button = reloadButton({ reloading: true })

    expect(button.props.disabled).toBe(false)
    expect(button.props['aria-disabled']).toBe(true)
    expect(button.props['aria-busy']).toBe(true)
    expect(refreshIcon(button).props.className).toBe(styles.spin)
    expect(statusNode({ reloading: true }).props.children).toBe('正在刷新')
  })

  it('busy：disabled、aria-disabled 不渲染、不转也不播报', () => {
    const button = reloadButton({ busy: true })

    expect(button.props.disabled).toBe(true)
    expect(button.props['aria-disabled']).toBeUndefined()
    expect(button.props['aria-busy']).toBe(false)
    expect(refreshIcon(button).props.className).toBeUndefined()
    expect(statusNode({ busy: true }).props.children).toBe('')
  })

  it('服务端 HTML：idle 无 disabled / aria-disabled；reloading 只 aria-disabled；busy 只 disabled', () => {
    const idle = renderSettings()
    expect(idle).toContain('aria-label="刷新"')
    expect(idle).toContain('data-dsh-action="reload"')
    expect(idle).toContain('title="刷新（重新读取智能体 / 团队 / 模型 / preset）"')
    const idleButton = reloadButtonHtml(idle)
    expect(idleButton).not.toMatch(/\sdisabled(=|\s|>)/)
    expect(idleButton).not.toContain('aria-disabled')
    expect(idleButton).not.toContain(styles.spin)
    expect(idle).toContain('role="status"')
    expect(statusHtml(idle)).toBe('')

    const reloading = renderSettings({ reloading: true })
    const reloadingButton = reloadButtonHtml(reloading)
    expect(reloadingButton).not.toMatch(/\sdisabled(=|\s|>)/)
    expect(reloadingButton).toContain('aria-disabled="true"')
    expect(reloadingButton).toContain('aria-busy="true"')
    expect(reloadingButton).toContain(styles.spin)
    expect(statusHtml(reloading)).toBe('正在刷新')

    const busy = renderSettings({ busy: true })
    const busyButton = reloadButtonHtml(busy)
    expect(busyButton).toContain('disabled=""')
    expect(busyButton).not.toContain('aria-disabled')
    expect(busyButton).toContain('aria-busy="false"')
    expect(busyButton).not.toContain(styles.spin)
    expect(statusHtml(busy)).toBe('')
  })

  it('错误条 role="alert"；出错且列表为空时不渲染空态，但已有条目照常显示', () => {
    const tree = settingsTree({ error: '读取失败' })
    const alert = findElement(tree, element => element.type === 'p' && element.props.role === 'alert')
    expect(alert).not.toBeNull()
    expect(alert.props.className).toBe(styles.error)
    expect(alert.props.children).toBe('读取失败')

    const failed = renderSettings({ error: '读取失败' })
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('读取失败')
    expect(failed).not.toContain('还没有智能体')
    expect(failed).not.toContain('还没有团队')

    const empty = renderSettings()
    expect(empty).toContain('还没有智能体。点右上角新建。')
    expect(empty).toContain('还没有团队。把智能体组合起来即可。')

    const withProfiles = renderSettings({ error: '读取失败', profiles: [profile('reviewer', 'Reviewer')] })
    expect(withProfiles).toContain('role="alert"')
    expect(withProfiles).toContain('Reviewer')
    expect(withProfiles).not.toContain('还没有智能体')
  })
})

/* ---------- TypeScript AST：源码契约 ---------- */

const typescriptPromise = import(pathToFileURL(pkgRequire.resolve('typescript')).href)
  .then((module: any) => module.default ?? module)
const ts = await typescriptPromise

function walk(node: any, visit: (node: any) => void): void {
  visit(node)
  ts.forEachChild(node, (child: any) => walk(child, visit))
}

function parseSource(path: string): any {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

function jsxAttributes(opening: any): Map<string, any> {
  const attributes = new Map<string, any>()
  for (const property of opening.attributes?.properties ?? []) {
    if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(), property)
  }
  return attributes
}

function attributeText(attribute: any): string | null {
  const initializer = attribute?.initializer
  if (initializer === undefined) return null
  return ts.isStringLiteral(initializer) ? initializer.text : initializer.getText()
}

function expressionText(attribute: any): string | null {
  const initializer = attribute?.initializer
  if (initializer === undefined || !ts.isJsxExpression(initializer) || initializer.expression === undefined) {
    return null
  }
  return initializer.expression.getText()
}

function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

function findRefreshButtonOpening(): any {
  const file = parseSource(SETTINGS_TSX)
  let found: any = null
  walk(file, node => {
    if (found !== null) return
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
    if (node.tagName.getText() !== 'button') return
    const attributes = jsxAttributes(node)
    const action = attributes.get('data-dsh-action')
    if (attributeText(action) === 'reload') found = node
  })
  if (found === null) throw new Error('AgentStudioSettings.tsx 里找不到 data-dsh-action="reload" 的 button')
  return found
}

function childElements(element: any): any[] {
  return (element.children ?? []).filter(
    (child: any) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
  )
}

function jsxTextOf(element: any): string {
  return (element.children ?? [])
    .filter((child: any) => ts.isJsxText(child))
    .map((child: any) => child.getText())
    .join('')
}

function enclosingJsxExpression(node: any): any {
  let current = node
  while (current !== undefined && current !== null) {
    if (ts.isJsxExpression(current)) return current
    current = current.parent
  }
  return null
}

describe('刷新按钮（源码契约）', () => {
  it('声明了 aria-label / title / data-dsh-action / type', () => {
    const attributes = jsxAttributes(findRefreshButtonOpening())
    expect(attributeText(attributes.get('type'))).toBe('button')
    expect(attributeText(attributes.get('aria-label'))).toBe('刷新')
    expect(attributeText(attributes.get('title'))).toContain('刷新')
    expect(attributeText(attributes.get('title'))).toContain('团队')
    expect(attributeText(attributes.get('title'))).toContain('preset')
    expect(attributeText(attributes.get('data-dsh-action'))).toBe('reload')
  })

  it('disabled 只看 busy；aria-disabled / aria-busy 只看 reloading', () => {
    const attributes = jsxAttributes(findRefreshButtonOpening())
    expect(compact(expressionText(attributes.get('disabled')) ?? '')).toBe('s.busy')
    expect(compact(expressionText(attributes.get('aria-disabled')) ?? '')).toBe('s.reloading||undefined')
    expect(compact(expressionText(attributes.get('aria-busy')) ?? '')).toBe('s.reloading')
  })

  it('onClick 调用 reload，图标 refresh 在 reloading 时挂 styles.spin', () => {
    const opening = findRefreshButtonOpening()
    const attributes = jsxAttributes(opening)
    const onClick = compact(expressionText(attributes.get('onClick')) ?? '')
    expect(onClick).toContain('voids.reload()')

    const icon = (opening.parent as any).children.find((child: any) =>
      (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child))
      && (ts.isJsxElement(child) ? child.openingElement : child).tagName.getText() === 'StudioIcon',
    )
    expect(icon, '刷新按钮里找不到 StudioIcon').toBeDefined()
    const iconOpening = ts.isJsxElement(icon) ? icon.openingElement : icon
    const iconAttributes = jsxAttributes(iconOpening)
    expect(attributeText(iconAttributes.get('name'))).toBe('refresh')
    const spin = compact(expressionText(iconAttributes.get('className')) ?? '')
    expect(spin).toContain('s.reloading')
    expect(spin).toContain('styles.spin')
  })

  it('headerActions 里按钮后面紧跟 srOnly 的 role="status" 状态区', () => {
    const opening = findRefreshButtonOpening()
    const headerActions = opening.parent.parent
    expect(ts.isJsxElement(headerActions)).toBe(true)
    expect(headerActions.openingElement.tagName.getText()).toBe('div')
    expect(compact(expressionText(jsxAttributes(headerActions.openingElement).get('className')) ?? ''))
      .toBe('styles.headerActions')

    const children = childElements(headerActions)
    const refreshIndex = children.indexOf(opening.parent)
    expect(refreshIndex, 'headerActions 里找不到刷新按钮的 JSX 元素').toBeGreaterThan(-1)
    const statusIndex = children.findIndex((child: any) =>
      ts.isJsxElement(child)
      && child.openingElement.tagName.getText() === 'span'
      && attributeText(jsxAttributes(child.openingElement).get('role')) === 'status',
    )
    expect(statusIndex, 'headerActions 里没有 role="status" 的 span').toBeGreaterThan(-1)
    expect(statusIndex).toBeGreaterThan(refreshIndex)
    expect(refreshIndex).toBe(0)

    const status = children[statusIndex]
    const attributes = jsxAttributes(status.openingElement)
    expect(compact(expressionText(attributes.get('className')) ?? '')).toBe('styles.srOnly')
    const expression = (status.children ?? []).find(
      (child: any) => ts.isJsxExpression(child) && child.expression !== undefined,
    )
    expect(expression, '状态区里没有 live 文本表达式').toBeDefined()
    expect(compact(expression.expression.getText())).toBe("s.reloading?'正在刷新':''")
  })

  it('错误条是受 s.error !== \'\' 控制的 <p role="alert">', () => {
    const file = parseSource(SETTINGS_TSX)
    let alert: any = null
    walk(file, node => {
      if (alert !== null) return
      if (!ts.isJsxElement(node)) return
      if (node.openingElement.tagName.getText() !== 'p') return
      if (attributeText(jsxAttributes(node.openingElement).get('role')) === 'alert') alert = node
    })
    expect(alert, 'AgentStudioSettings.tsx 里找不到 role="alert" 的错误条').not.toBeNull()
    const attributes = jsxAttributes(alert.openingElement)
    expect(compact(expressionText(attributes.get('className')) ?? '')).toBe('styles.error')
    const guard = enclosingJsxExpression(alert)
    expect(guard, '错误条没有包在 JSX 表达式里').not.toBeNull()
    expect(compact(guard.expression.getText())).toContain("s.error!==''")
  })

  it('列表空态只有在 s.error === \'\' 时才渲染', () => {
    const file = parseSource(SETTINGS_TSX)
    const guards = new Map<string, string>()
    walk(file, node => {
      if (!ts.isJsxElement(node)) return
      if (node.openingElement.tagName.getText() !== 'p') return
      const text = jsxTextOf(node)
      if (!text.includes('还没有智能体') && !text.includes('还没有团队')) return
      const guard = enclosingJsxExpression(node)
      guards.set(text.trim(), compact(guard?.expression?.getText() ?? ''))
    })
    expect([...guards.keys()].sort()).toEqual(['还没有团队。把智能体组合起来即可。', '还没有智能体。点右上角新建。'].sort())
    for (const [text, guard] of guards) {
      expect(guard, `${text} 的空态没有 s.error === '' 守卫`).toContain("s.error===''")
      expect(guard).toContain('length===0')
    }
  })
})

/* ---------- useAgentStudioSettings.reload：行为 ---------- */

const ENDPOINTS = ['listProfiles', 'listTeams', 'listModels', 'listPresets'] as const

function ok(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value }
}

function makeStudio(
  overrides: Partial<Record<(typeof ENDPOINTS)[number], () => Promise<unknown>>> = {},
): { studio: Record<string, () => Promise<unknown>>; calls: Record<string, number> } {
  const methods: Record<string, () => Promise<unknown>> = {
    listProfiles: () => Promise.resolve(ok([])),
    listTeams: () => Promise.resolve(ok([])),
    listModels: () => Promise.resolve(ok([])),
    listPresets: () => Promise.resolve(ok([])),
  }
  for (const endpoint of ENDPOINTS) {
    const override = overrides[endpoint]
    if (override !== undefined) methods[endpoint] = override
  }
  const calls: Record<string, number> = {}
  const studio: Record<string, () => Promise<unknown>> = {}
  for (const endpoint of ENDPOINTS) {
    calls[endpoint] = 0
    const method = methods[endpoint] as () => Promise<unknown>
    studio[endpoint] = () => {
      calls[endpoint] = (calls[endpoint] ?? 0) + 1
      return method()
    }
  }
  return { studio, calls }
}

function deferred<T = unknown>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

async function settle(rounds = 3): Promise<void> {
  for (let index = 0; index < rounds; index++) {
    await new Promise<void>(resolve => { setTimeout(resolve, 0) })
  }
}

let compiledHook: string | null = null

function hookCommonJs(): string {
  compiledHook ??= ts.transpileModule(readFileSync(HOOK_TS, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  return compiledHook
}

interface HookView {
  reload: () => Promise<void>
  reloading: boolean
  busy: boolean
  error: string
  profiles: unknown[]
  removeProfile: (id: string) => void
  setProfileDraft: (draft: unknown) => void
  [key: string]: any
}

function createHookHarness(): { render: (studio: unknown) => HookView } {
  const states: unknown[] = []
  const refs: { current: unknown }[] = []
  let stateCursor = 0
  let refCursor = 0

  const reactStub = {
    useState(initial: unknown) {
      const index = stateCursor++
      if (index >= states.length) {
        states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      return [states[index], (next: unknown) => {
        states[index] = typeof next === 'function'
          ? (next as (previous: unknown) => unknown)(states[index])
          : next
      }]
    },
    useRef(initial: unknown) {
      const index = refCursor++
      if (index >= refs.length) refs.push({ current: initial })
      return refs[index]
    },
    useCallback(fn: unknown) {
      return fn
    },
    useEffect() {},
  }

  const exports: Record<string, unknown> = {}
  const requireShim = (id: string): unknown => {
    if (id === 'react') return reactStub
    if (id.endsWith('core/result.ts')) return { errorText, unwrap }
    throw new Error(`hook 桩不认识的 require('${id}')`)
  }
  const factory = new Function('exports', 'require', 'module', hookCommonJs()) as (
    exports: Record<string, unknown>,
    require: (id: string) => unknown,
    module: { exports: Record<string, unknown> },
  ) => void
  factory(exports, requireShim, { exports })

  const useHook = exports.useAgentStudioSettings as (studio: unknown) => HookView
  if (typeof useHook !== 'function') throw new Error('transpile 后的 hook 模块没有 useAgentStudioSettings')
  return {
    render: (studio: unknown) => {
      stateCursor = 0
      refCursor = 0
      return useHook(studio)
    },
  }
}

describe('useAgentStudioSettings.reload（行为）', () => {
  it('返回值含 reload / reloading，不含 refresh；初始 reloading=false', () => {
    const { studio } = makeStudio()
    const view = createHookHarness().render(studio)

    expect(typeof view.reload).toBe('function')
    expect(typeof view.reloading).toBe('boolean')
    expect(view.reloading).toBe(false)
    expect(view.refresh).toBeUndefined()
    expect('refresh' in view).toBe(false)
  })

  it('hook 返回对象与源码都不再暴露 refresh（内部 effect / run 保留）', () => {
    let hook: any = null
    walk(parseSource(HOOK_TS), node => {
      if (hook !== null) return
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'useAgentStudioSettings') hook = node
    })
    expect(hook, 'hook 文件里找不到 useAgentStudioSettings 函数声明').not.toBeNull()
    let names: string[] | null = null
    walk(hook, node => {
      if (names !== null) return
      if (!ts.isReturnStatement(node) || node.expression === undefined) return
      if (!ts.isObjectLiteralExpression(node.expression)) return
      if (node.expression.properties.length < 10) return
      names = node.expression.properties.map((property: any) => property.name?.getText?.() ?? '')
    })
    expect(names, 'hook 里找不到返回对象').not.toBeNull()
    expect(names).toContain('reload')
    expect(names).toContain('reloading')
    expect(names).not.toContain('refresh')

    const source = compact(readFileSync(HOOK_TS, 'utf8'))
    expect(source).toContain('constreloadInFlight=useRef(false)')
    expect(source).not.toContain('reloadingRef')
    expect(source).toContain('constfetchSeq=useRef(0)')
  })

  it('reload 未结束时再次调用不会重复请求（useRef 守卫）', async () => {
    const gates = {
      listProfiles: deferred(),
      listTeams: deferred(),
      listModels: deferred(),
      listPresets: deferred(),
    }
    const { studio, calls } = makeStudio({
      listProfiles: () => gates.listProfiles.promise,
      listTeams: () => gates.listTeams.promise,
      listModels: () => gates.listModels.promise,
      listPresets: () => gates.listPresets.promise,
    })
    const harness = createHookHarness()
    const view = harness.render(studio)

    const running = view.reload()
    const during = harness.render(studio)
    expect(during.reloading).toBe(true)
    const duplicate = during.reload()
    expect(calls).toEqual({ listProfiles: 1, listTeams: 1, listModels: 1, listPresets: 1 })

    for (const gate of Object.values(gates)) gate.resolve(ok([]))
    await running
    await duplicate
    const settled = harness.render(studio)
    expect(settled.reloading).toBe(false)
    expect(settled.error).toBe('')

    await settled.reload()
    expect(calls.listProfiles).toBe(2)
    expect(calls.listTeams).toBe(2)
  })

  it('失败时写入 errorText，并复位 reloading、释放守卫', async () => {
    const { studio, calls } = makeStudio({
      listProfiles: () => Promise.resolve({ ok: false, error: '列不出 Agent' }),
    })
    const harness = createHookHarness()
    const view = harness.render(studio)

    await expect(view.reload()).resolves.toBeUndefined()
    const failed = harness.render(studio)
    expect(failed.error).toBe('列不出 Agent')
    expect(failed.reloading).toBe(false)

    await failed.reload()
    expect(calls.listProfiles).toBe(2)
  })

  it('请求 reject 同样转成 error 文案', async () => {
    const { studio } = makeStudio({
      listPresets: () => Promise.reject(new Error('preset 读取失败')),
    })
    const harness = createHookHarness()

    await harness.render(studio).reload()
    const view = harness.render(studio)
    expect(view.error).toBe('preset 读取失败')
    expect(view.reloading).toBe(false)
  })

  it('reload 一开始就清空上一次的 error', async () => {
    const failing = makeStudio({
      listProfiles: () => Promise.resolve({ ok: false, error: '旧错误' }),
    })
    const harness = createHookHarness()
    await harness.render(failing.studio).reload()
    expect(harness.render(failing.studio).error).toBe('旧错误')

    const gate = deferred()
    const succeeding = makeStudio({ listProfiles: () => gate.promise })
    const view = harness.render(succeeding.studio)
    const pending = view.reload()

    const during = harness.render(succeeding.studio)
    expect(during.error).toBe('')
    expect(during.reloading).toBe(true)

    gate.resolve(ok([]))
    await pending
    const done = harness.render(succeeding.studio)
    expect(done.error).toBe('')
    expect(done.reloading).toBe(false)
  })
})

describe('useAgentStudioSettings 刷新代次（并发回归）', () => {
  /**
   * 造两个 fetchSeq 代次：
   * - reload() 发第一次（挂起，旧快照 / 旧失败）；
   * - removeProfile() → run() → refresh() 发第二次（立即返回新快照）。
   * 第一代晚到时，代次校验必须拦住 unwrap 与 setState。
   */
  function raceStudio(staleProfiles: Promise<unknown>, freshProfiles: Record<string, unknown>[]): {
    studio: Record<string, () => Promise<unknown>>
    profileCalls: () => number
  } {
    let profileCalls = 0
    const studio: Record<string, () => Promise<unknown>> = {
      listProfiles: () => {
        profileCalls += 1
        return profileCalls === 1 ? staleProfiles : Promise.resolve(ok(freshProfiles))
      },
      listTeams: () => Promise.resolve(ok([])),
      listModels: () => Promise.resolve(ok([])),
      listPresets: () => Promise.resolve(ok([])),
      deleteProfile: () => Promise.resolve(ok(null)),
    }
    return { studio, profileCalls: () => profileCalls }
  }

  it('旧请求晚到不覆盖新快照', async () => {
    const stale = deferred()
    const fresh = [profile('new-agent', 'New')]
    const old = [profile('old-one', 'Old One'), profile('old-two', 'Old Two')]
    const { studio, profileCalls } = raceStudio(stale.promise, fresh)
    const harness = createHookHarness()

    const first = harness.render(studio).reload()
    await settle()
    expect(harness.render(studio).reloading).toBe(true)

    harness.render(studio).removeProfile('old-one')
    await settle()
    expect(profileCalls()).toBe(2)
    expect(harness.render(studio).profiles).toEqual(fresh)
    expect(harness.render(studio).busy).toBe(false)

    stale.resolve(ok(old))
    await first

    const settled = harness.render(studio)
    expect(settled.profiles).toEqual(fresh)
    expect(settled.reloading).toBe(false)
    expect(settled.error).toBe('')
  })

  it('过期请求的失败结果不污染 error', async () => {
    const stale = deferred()
    const fresh = [profile('new-agent', 'New')]
    const { studio } = raceStudio(stale.promise, fresh)
    const harness = createHookHarness()

    const first = harness.render(studio).reload()
    await settle()
    harness.render(studio).removeProfile('old-one')
    await settle()
    expect(harness.render(studio).profiles).toEqual(fresh)

    stale.resolve({ ok: false, error: '过期的列取失败' })
    await expect(first).resolves.toBeUndefined()

    const settled = harness.render(studio)
    expect(settled.error).toBe('')
    expect(settled.profiles).toEqual(fresh)
    expect(settled.reloading).toBe(false)
  })

})

describe('useAgentStudioSettings 源码契约（代次守卫顺序）', () => {
  it('refresh 先自增代次再发请求，代次校验在 unwrap 之前', () => {
    const source = compact(readFileSync(HOOK_TS, 'utf8'))
    const increment = source.indexOf('constmine=++fetchSeq.current')
    const request = source.indexOf('awaitPromise.all')
    const guard = source.indexOf('if(mine!==fetchSeq.current)return')
    const firstUnwrap = source.indexOf('unwrap(p)')
    const firstSet = source.indexOf('setProfiles(next[0])')

    expect(increment, 'refresh 里找不到 `const mine = ++fetchSeq.current`').toBeGreaterThan(-1)
    expect(request, 'refresh 里找不到 `await Promise.all`').toBeGreaterThan(-1)
    expect(guard, 'refresh 里找不到 `if (mine !== fetchSeq.current) return`').toBeGreaterThan(-1)
    expect(firstUnwrap, 'refresh 里找不到 `unwrap(p)`').toBeGreaterThan(-1)
    expect(increment).toBeLessThan(request)
    expect(guard).toBeGreaterThan(request)
    expect(guard).toBeLessThan(firstUnwrap)
    expect(guard).toBeLessThan(firstSet)
  })
})

/* ---------- CSS Modules 契约 ---------- */

function cssText(): string {
  return readFileSync(CSS_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

interface CssRule {
  selector: string
  body: string
}

/** 扁平规则解析：选择器列表按逗号拆开，声明块压掉空白。@media 里的规则也能取到。 */
function cssRules(): CssRule[] {
  const rules: CssRule[] = []
  for (const match of cssText().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = (match[2] ?? '').replace(/\s+/g, '')
    for (const raw of (match[1] ?? '').split(',')) {
      const selector = raw.trim()
      if (selector !== '') rules.push({ selector, body })
    }
  }
  return rules
}

function ruleBodies(selector: string): string[] {
  return cssRules().filter(rule => rule.selector === selector).map(rule => rule.body)
}

describe('AgentStudioSettings.module.css（刷新按钮样式）', () => {
  it('.spin 使用 agent-studio-spin 无限循环动画', () => {
    const blocks = ruleBodies('.spin')
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    expect(blocks.some(block => block.includes('animation:agent-studio-spin'))).toBe(true)
    expect(blocks.some(block => block.includes('linear') && block.includes('infinite'))).toBe(true)
  })

  it('@keyframes agent-studio-spin 旋转 360 度', () => {
    expect(cssText()).toMatch(/@keyframes\s+agent-studio-spin\s*\{[\s\S]*?transform:\s*rotate\(360deg\)/)
  })

  it('prefers-reduced-motion 下关掉 spin 动画', () => {
    const match = cssText().match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.spin\s*\{([^{}]*)\}/,
    )
    expect(match, '没有 prefers-reduced-motion 的 .spin 覆盖').not.toBeNull()
    expect((match?.[1] ?? '').replace(/[\s;]+/g, '')).toBe('animation:none')
  })

  it('disabled 态降低透明度，且不再靠 :disabled:hover 复位 hover 背景', () => {
    const disabled = ruleBodies('.iconButton:disabled')
    expect(disabled.some(block => block.includes('opacity:0.5') && block.includes('cursor:default'))).toBe(true)
    expect(cssRules().some(rule => rule.selector === '.iconButton:disabled:hover')).toBe(false)
  })

  it('hover 只在未 disabled 时生效（:hover:not(:disabled)）', () => {
    const hover = ruleBodies('.iconButton:hover:not(:disabled)')
    expect(hover).toHaveLength(1)
    expect(hover[0]).toContain('background:var(--dsw-alias-interactive-bg-hover)')
    expect(hover[0]).toContain('color:var(--dsw-alias-label-primary)')
  })

  it('aria-disabled 态用 cursor:progress 表达「刷新中」', () => {
    const blocks = ruleBodies(".iconButton[aria-disabled='true']")
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('cursor:progress')
  })

  it('.srOnly 存在，并在 TSX 里通过 styles.srOnly 引用', () => {
    const blocks = ruleBodies('.srOnly')
    expect(blocks).toHaveLength(1)
    const body = blocks[0] as string
    expect(body).toContain('position:absolute')
    expect(body).toContain('width:1px')
    expect(body).toContain('height:1px')
    expect(body).toContain('overflow:hidden')
    expect(body).toContain('clip:rect(0000)')
    expect(readFileSync(SETTINGS_TSX, 'utf8')).toContain('styles.srOnly')
  })
})

/* ---------- StudioIcon.refresh ---------- */

describe('StudioIcon 的 refresh 分支', () => {
  it('渲染两个 path 并透传 className', () => {
    const icon = (StudioIcon as any)({ name: 'refresh' })
    expect(icon.type).toBe('svg')
    const children = Array.isArray(icon.props.children) ? icon.props.children : [icon.props.children]
    expect(children).toHaveLength(2)
    expect(children.every((child: any) => child.type === 'path')).toBe(true)

    const styled = (StudioIcon as any)({ name: 'refresh', className: '_spin_test' })
    expect(styled.props.className).toBe('_spin_test')
  })

  it('类型联合与 props 声明了 refresh / className，switch 有 refresh 分支', () => {
    const file = parseSource(STUDIO_ICON_TSX)
    let refreshInType = false
    let classNameInProps = false
    let refreshCase = false
    walk(file, node => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === 'StudioIconName' && ts.isUnionTypeNode(node.type)) {
        refreshInType = node.type.types.some(
          (member: any) => ts.isLiteralTypeNode(member)
            && ts.isStringLiteral(member.literal)
            && member.literal.text === 'refresh',
        )
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'StudioIconProps') {
        classNameInProps = node.members.some((member: any) => member.name?.getText() === 'className')
      }
      if (ts.isCaseClause(node) && node.expression.getText() === "'refresh'") refreshCase = true
    })
    expect(refreshInType).toBe(true)
    expect(classNameInProps).toBe(true)
    expect(refreshCase).toBe(true)
  })
})
