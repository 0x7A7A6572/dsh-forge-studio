/**
 * 主题转译：磁盘 `.tsx` → 浏览器里可跑的经典脚本（自调 define 的 IIFE，不是 ES module）。
 * 这里只编译出文本，`require` / `define` 都在浏览器里才发生。
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { build } from 'esbuild'
import type { Plugin } from 'esbuild'
import { THEME_ALLOWED_MODULES } from '../shape/index.ts'
import type { ThemeSource } from './discover.ts'

/** 主题产物里那个全局宿主的名字（与 client/hooks/theme-runtime.ts 一致）。 */
export const THEME_HOST_GLOBAL = '__usageBillingThemeHost'

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function realPathOf(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** 目录与缺失路径都不算命中，得交给解析器。 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function statOf(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

function outsideError(specifier: string): { errors: { text: string }[] } {
  return { errors: [{ text: `主题不许 import 自己目录之外的文件：${specifier}` }] }
}

function nodeModulesError(specifier: string): { errors: { text: string }[] } {
  return {
    errors: [{
      text: `主题目录里的 node_modules 不许相对 import（会把第二份 React 内联进来，hooks 会静默失效）：${specifier}`,
    }],
  }
}

/** root 自己路径里的 node_modules 段不算。 */
function throughNodeModules(root: string, target: string): boolean {
  return relative(root, target).split(/[\\/]/).includes('node_modules')
}

/**
 * 兜底解析的标记：`pluginBuild.resolve()` 会回调本插件的 onResolve，不区分就会递归自己。
 * 带此 marker 的那一次放过，走 esbuild 默认解析器。
 */
const FALLBACK_MARK = 'usage-billing-theme-fallback'

/**
 * 主题 ABI 把守者：放行白名单与主题目录内的文件，其余转译期报错。
 * 判定分两层 —— 先查逻辑路径，再 realpath 比对；只查逻辑路径会被 symlink / junction 绕过。
 */
function guardPlugin(source: ThemeSource): Plugin {
  let realDir: string
  try {
    realDir = realpathSync(source.dir)
  } catch {
    throw new Error(`主题目录读不到（可能刚被删除或改名）：${source.dir}`)
  }
  return {
    name: 'usage-billing-theme-guard',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData === FALLBACK_MARK) return undefined
        if (args.kind === 'entry-point') return { path: args.path }
        if (THEME_ALLOWED_MODULES.includes(args.path)) return { path: args.path, external: true }
        if (!args.path.startsWith('.')) {
          return {
            errors: [{
              text: `主题只能 import ${THEME_ALLOWED_MODULES.join(' / ')}，收到 "${args.path}"`,
            }],
          }
        }
        if (args.path.endsWith('.css')) {
          return { errors: [{ text: '样式请放主题目录下的 styles.css（主题里没有 CSS Modules）' }] }
        }
        const target = resolve(dirname(args.importer), args.path)
        if (target === source.dir) {
          return { errors: [{ text: `主题不能 import 目录本身（要引主题入口就直接写在 index.tsx 里）：${args.path}` }] }
        }
        // 第一层：逻辑路径，不碰 fs。
        if (!isInside(source.dir, target)) return outsideError(args.path)
        if (throughNodeModules(source.dir, target)) return nodeModulesError(args.path)
        // 第二层：真实路径，仅拼写骗得过第一层。
        const real = realPathOf(target)
        if (real !== undefined) {
          if (!isInside(realDir, real)) return outsideError(args.path)
          // node_modules 要在真实路径上再判一次：`vendor -> node_modules` 拼写里没有这一段。
          // 已知边界：把 react 复制进主题目录里别的子目录，照旧放行。
          if (throughNodeModules(realDir, real)) return nodeModulesError(args.path)
          if (isFile(real)) return { path: target }
        }
        // 兜底解析的结果要再判一遍，兜底不能变成绕过口。
        const resolved = await pluginBuild.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          resolveDir: dirname(args.importer),
          namespace: 'file',
          pluginData: FALLBACK_MARK,
        })
        if (resolved.errors.length === 0 && resolved.path !== '') {
          const realResolved = realPathOf(resolved.path)
          if (realResolved === undefined) {
            return { errors: [{ text: `主题里的文件读不到（可能刚被删除或改名）：${args.path}` }] }
          }
          if (!isInside(realDir, realResolved)) return outsideError(args.path)
          if (throughNodeModules(realDir, realResolved)) return nodeModulesError(args.path)
          return { path: resolved.path }
        }
        return { path: target }
      })
    },
  }
}

/** 把 cjs 产物包成自调 define 的 IIFE；`module` / `exports` 是 esbuild cjs 产物的前提。 */
function wrapTheme(id: string, code: string): string {
  return [
    '(function () {',
    'var module = { exports: {} }; var exports = module.exports;',
    `var require = function (specifier) { return globalThis.${THEME_HOST_GLOBAL}.require(specifier) };`,
    code,
    `globalThis.${THEME_HOST_GLOBAL}.define(${JSON.stringify(id)}, module.exports.theme);`,
    '})();',
  ].join('\n')
}

/** 进程内共享的转译器；缓存挂在它上面，路由只建一个。 */
export interface ThemeTranspiler {
  js(source: ThemeSource): Promise<string>
  /** 没有样式文件时抛错。 */
  css(source: ThemeSource): Promise<string>
}

interface CacheRow {
  readonly key: string
  readonly value: string
}

/**
 * 缓存键：整棵主题目录的递归快照（每个文件 `相对路径\0mtimeMs\0size`，排序后拼接）。
 * 只 stamp 入口不够：改 `card.tsx` 时入口一个字节都没变。
 * 两条边界：node_modules 子树不参与；条目数有上限，超限改用目录 mtime 兜底。
 */
function stampOf(dir: string): string {
  const rows: string[] = []
  let budget = STAMP_MAX_ENTRIES
  const walk = (current: string): void => {
    if (budget <= 0) {
      rows.push(dirRow(dir, current))
      return
    }
    budget -= 1 // 目录也占一个名额。
    let items: Dirent[]
    try {
      items = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    // readdir 顺序无保证，排序后超限时进 stamp 的条目才确定。
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const children: string[] = []
    for (const item of items) {
      // 剪掉 node_modules：guard 拒掉任何带该段的解析结果，它变了也不必让缓存失效。
      // 点目录不剪（`./.foo/x.ts` 能合法 import，剪了就变成改了文件看不见变化）。
      if (item.name === 'node_modules') continue
      if (item.isDirectory()) {
        children.push(join(current, item.name))
        continue
      }
      if (!item.isFile()) continue
      if (budget <= 0) {
        rows.push(dirRow(dir, current))
        return
      }
      budget -= 1
      const full = join(current, item.name)
      const stat = statOf(full)
      if (stat === undefined) continue
      rows.push(`${relative(dir, full)}\0${String(stat.mtimeMs)}\0${String(stat.size)}`)
    }
    // 文件排在子目录前面：预算吃紧时先保证浅层文件进 stamp。
    for (const child of children) walk(child)
  }
  walk(dir)
  return rows.sort().join('\n')
}

/**
 * 单次 stamp 的条目上限（文件 1 个、目录 1 个）。用尽后改用目录 mtime 兜底（{@link dirRow}）：
 * 增删文件仍会失效，超限子树里已存在文件的内容改动可能不再失效。
 */
const STAMP_MAX_ENTRIES = 512

/** stamp 超限时的兜底行：增删直接子项会改目录 mtime。 */
function dirRow(dir: string, current: string): string {
  return `${relative(dir, current) || '.'}\0dir\0${String(statOf(current)?.mtimeMs ?? 'unknown')}`
}

/** 不受 stamp 上限影响。 */
function selfRow(path: string): string {
  const stat = statOf(path)
  return stat === undefined
    ? `${path}\0missing`
    : `${path}\0${String(stat.mtimeMs)}\0${String(stat.size)}`
}

export function createThemeTranspiler(): ThemeTranspiler {
  const cache = new Map<string, CacheRow>()

  const cached = async (
    path: string,
    dir: string,
    produce: () => Promise<string> | string,
  ): Promise<string> => {
    // 入口 / 样式自己永远单独进键：超限后只看目录 mtime，漏得掉内容改动。
    const key = `${stampOf(dir)}\0${selfRow(path)}`
    const hit = cache.get(path)
    if (hit !== undefined && hit.key === key) return hit.value
    const value = await produce()
    cache.set(path, { key, value })
    return value
  }

  return {
    js: async (source) => await cached(source.entry, source.dir, async () => {
      const result = await build({
        entryPoints: [source.entry],
        absWorkingDir: source.dir,
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource: 'react',
        // esbuild 默认转义非 ASCII；主题的 label 是中文，产物按 UTF-8 原文下发。
        // 路由那边必须带 charset=utf-8。
        charset: 'utf8',
        logLevel: 'silent',
        plugins: [guardPlugin(source)],
      })
      const code = result.outputFiles[0]?.text
      if (code === undefined || code === '') throw new Error(`主题 ${source.id} 转译没有产物`)
      return wrapTheme(source.id, code)
    }),
    css: async (source) => {
      if (source.style === undefined) throw new Error(`主题 ${source.id} 没有 styles.css`)
      return await cached(source.style, dirname(source.style), () => readFileSync(source.style as string, 'utf8'))
    },
  }
}
