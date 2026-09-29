/**
 * 主题转译：磁盘上的 `.tsx` → 一段能在浏览器里跑的**经典脚本**。
 *
 * 形状是「自调 define 的 IIFE」，不是 ES module：
 *
 * ```js
 * (function () {
 *   var module = { exports: {} }; var exports = module.exports;
 *   var require = function (s) { return globalThis.__usageBillingThemeHost.require(s) };
 *   …esbuild 的 cjs 产物…
 *   globalThis.__usageBillingThemeHost.define("line", module.exports.theme)
 * })();
 * ```
 *
 * 为什么不发 ES module：模块表（`window.__ModuleLoader__`）只认宿主生成的 boot graph，
 * 主题进不去那张图；而 dsh 的 client 预设会把动态 `import()` 内联掉，客户端也 import
 * 不了任意 URL。经典脚本 + 全局宿主是唯一不依赖宿主内部机制的通道。
 *
 * **node 侧不执行主题代码**：这里只把源码编译成文本，`require` 与 `define` 都在浏览器里
 * 才发生。所以主题里写 `throw` 也不会影响宿主进程。
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

/** `target` 是绝对路径时，它是否落在 `root` 里面。 */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** `realpathSync` 的「拿不到就当未知」变体：文件不存在 / 没权限时不做判定，交给后面的解析路径。 */
function realPathOf(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/** 已存在的**普通文件**才算「逻辑路径本身就是答案」。目录（`./sub`）与缺失（`./geometry`）都要走解析器。 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** `statSync` 的「拿不到就当没有」变体（walk 到一半文件被删这类 TOCTOU）。 */
function statOf(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

/** 越界的统一失败文案（点出违规的那个 specifier）。 */
function outsideError(specifier: string): { errors: { text: string }[] } {
  return { errors: [{ text: `主题不许 import 自己目录之外的文件：${specifier}` }] }
}

/** `node_modules` 的统一失败文案（点出违规的那个 specifier）。 */
function nodeModulesError(specifier: string): { errors: { text: string }[] } {
  return {
    errors: [{
      text: `主题目录里的 node_modules 不许相对 import（会把第二份 React 内联进来，hooks 会静默失效）：${specifier}`,
    }],
  }
}

/** `target` 相对 `root` 的路径里有没有 `node_modules` 段 —— root 自己路径里有没有不算。 */
function throughNodeModules(root: string, target: string): boolean {
  return relative(root, target).split(/[\\/]/).includes('node_modules')
}

/**
 * 兜底解析用的标记。`pluginBuild.resolve()` 会**回调本插件的 onResolve**，不做区分就会自己
 * 递归自己（实测 esbuild 0.28.2）。带上这个 marker 的那一次解析放过，交给 esbuild 默认解析器；
 * marker 走 `pluginData` 原样传回，所以豁免只覆盖那一次解析，不会漏掉并发的其它 import。
 */
const FALLBACK_MARK = 'usage-billing-theme-fallback'

/**
 * 主题 ABI 的把守者：放行白名单与主题目录内的文件，其余一律转译期报错。
 *
 * 这条替代了原来的「形状包的独立性」四问 —— 那时靠 spec 扫源码确认形状不 import 宿主，
 * 现在由编译器挡：越界的 import 根本出不了产物。
 *
 * **判定分两层**：先做纯字符串的逻辑判定（`../` 这种不碰 fs 就拒掉），再把候选目标
 * `realpath` 成真实路径，跟主题目录的真实路径比对。只做前者会被 symlink / NTFS junction
 * 绕过（junction 不需要管理员权限就能建），把主题目录外的文件偷偷打进产物。
 */
function guardPlugin(source: ThemeSource): Plugin {
  let realDir: string
  try {
    realDir = realpathSync(source.dir)
  } catch {
    // 目录在扫盘与转译之间消失 / 改名：给一句读得懂的失败理由，别把裸 ENOENT 抛给路由。
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
        // 第一层：逻辑路径（不碰 fs）。
        if (!isInside(source.dir, target)) return outsideError(args.path)
        if (throughNodeModules(source.dir, target)) return nodeModulesError(args.path)
        // 第二层：真实路径。symlink / junction 把目录外的文件挂进主题目录时，逻辑路径看不出来。
        const real = realPathOf(target)
        if (real !== undefined) {
          if (!isInside(realDir, real)) return outsideError(args.path)
          // node_modules 段要在**真实路径**上再判一次：`vendor -> node_modules` 这种 junction
          // 的拼写里根本没有 node_modules，只查拼写会把第二份 React 放进来（hooks 静默失效）。
          //
          // 边界（写下来免得以后有人"顺手修"）：主题把 react **复制**到自己目录里一个不叫
          // node_modules 的普通子目录时，任何路径规则都区分不出来 —— 那是作者自己目录里的普通
          // 文件，这里照旧放行，这是有意的，不为此发明启发式。
          if (throughNodeModules(realDir, real)) return nodeModulesError(args.path)
          if (isFile(real)) return { path: target }
        }
        // 逻辑路径不是已存在的普通文件：可能是缺扩展名（`./geometry`）或指向目录（`./sub`）。
        // 交给 esbuild 自己的解析器，解析结果再过一遍上面的真实路径判定 —— 兜底不能变成新的绕过口。
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
            // 解析通过了却 realpath 不到（文件在两步之间被删 / 改名）：方向仍然是拒，
            // 但别说成「越界」—— 真正的问题是此刻读不到这个文件。
            return { errors: [{ text: `主题里的文件读不到（可能刚被删除或改名）：${args.path}` }] }
          }
          // 解析到了一个**主题目录外**的真实路径（例如 `./vendor/leak` 的 junction）：明确拒。
          if (!isInside(realDir, realResolved)) return outsideError(args.path)
          if (throughNodeModules(realDir, realResolved)) return nodeModulesError(args.path)
          return { path: resolved.path }
        }
        // 解析不出来（确实缺文件）：按原样交给 esbuild，报「Cannot read file」。
        return { path: target }
      })
    },
  }
}

/** 把 cjs 产物包成自调 define 的 IIFE。前三行是 esbuild cjs 产物的前提（它写的是 `exports`）。 */
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

/** 一个进程内共享的转译器（缓存也挂在它上面，所以路由只建一个）。 */
export interface ThemeTranspiler {
  /** 入口 → 可直接下发的脚本文本。 */
  js(source: ThemeSource): Promise<string>
  /** `styles.css` 原文；没有样式文件时抛错。 */
  css(source: ThemeSource): Promise<string>
}

interface CacheRow {
  readonly key: string
  readonly value: string
}

/**
 * 缓存键：**整棵主题目录**的递归快照（每个文件的 `相对路径\0mtimeMs\0size`，排序后拼接）。
 *
 * 只 stamp 入口是不够的：主题把手艺拆在 `card.tsx` / `line-geometry.ts` 里，改这些文件时
 * 入口一个字节都没变 —— 那样拿到的还是旧产物，而「改文件、刷页面、看见变化」正是这里的承诺。
 *
 * 两条边界（都在下面各自的位置有论证）：
 * - `node_modules` 子树**不参与** stamp —— guard 不允许产物依赖它，所以它变了也不必失效；
 * - 条目数有上限，超限后靠目录 mtime 兜底，保证单次请求的成本有界。
 */
function stampOf(dir: string): string {
  const rows: string[] = []
  let budget = STAMP_MAX_ENTRIES
  const walk = (current: string): void => {
    if (budget <= 0) {
      rows.push(dirRow(dir, current))
      return
    }
    budget -= 1 // 目录自己也占一个名额：整棵树的访问量因此严格有界。
    let items: Dirent[]
    try {
      items = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    // 名字排序：超限时「哪些条目进得了 stamp」才是确定的（readdir 的顺序没有保证）。
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const children: string[] = []
    for (const item of items) {
      // 剪掉 node_modules。这不是优化，是**语义上充分**的：guard 拒绝任何解析结果里带
      // `node_modules` 段的 specifier（拼写段与真实路径段各判一次），所以这棵子树里没有任何
      // 文件能影响产物 —— 它变了也不必让缓存失效。
      //
      // 反过来，点目录（`./.foo/x.ts`）**不剪**：那是主题可以合法 import 的东西，剪了就会
      // 重新变回「改了文件刷页面看不见变化」。
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
    // 文件排在子目录前面：预算吃紧时先保证浅层文件（入口 / 样式就在浅层）进 stamp。
    for (const child of children) walk(child)
  }
  walk(dir)
  return rows.sort().join('\n')
}

/**
 * 单次 stamp 的条目上限（文件 1 个、目录 1 个）。
 *
 * 主题通常只有几个文件；上限是给「主题目录里躺着一棵巨大的无关子树」兜底的 ——
 * `node_modules` 已经被剪掉，别的子树仍可能很大（reviewer 量的那棵 vendored 树让每次命中缓存的
 * `js()` 花 60ms+，而且是逐请求、线性、无界）。
 *
 * 用尽后**不再下降**，改用目录自身的 mtime 兜底（{@link dirRow}）：直接在超限目录里增删文件会改
 * 它的 mtime，所以「加文件 / 删文件」仍然失效。代价是超限子树里**已存在文件的内容改动**可能不再
 * 失效 —— 这是唯一牺牲精度的情形；入口 / 样式文件自己永远单独进键（见 `cached`），绝不会被挡住。
 * 绝不返回常量键：达不到精确失效时也只是「退化成目录级失效」。
 */
const STAMP_MAX_ENTRIES = 512

/** 目录自身的一行：stamp 超限时用它兜底（增删直接子项会改目录 mtime）。 */
function dirRow(dir: string, current: string): string {
  return `${relative(dir, current) || '.'}\0dir\0${String(statOf(current)?.mtimeMs ?? 'unknown')}`
}

/** 入口 / 样式文件自己的那一行（不受 stamp 上限影响）。 */
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
    // 入口 / 样式文件自己**永远**单独进键：stamp 有上限，超限后的兜底只看目录 mtime，
    // 那张网漏得掉「已存在文件的内容改动」—— 但绝不能漏掉入口本身。
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
        // esbuild 默认把非 ASCII 转成 `\uXXXX`。主题里的 label 是中文，
        // 转义后 spec 里的「改了文件再请求拿到新产物」就看不见标记了；
        // 产物按 UTF-8 原文下发（路由必须带 charset=utf-8，见 route 侧）。
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
