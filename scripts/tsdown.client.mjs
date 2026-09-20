/**
 * dsh 插件客户端产物的共享 tsdown 构建预设。
 *
 * 移植自官方 packages/client/tsdown.client.ts —— 那份不能直接 import：它开头就
 * 依赖 DSH 仓库内部模块（modules/src/client/manifest.ts、web/src/platform.ts、
 * scripts/client-build-environment.ts、scripts/bundle-input-isolation.ts），
 * 也没发布成 npm 包。这里保留外部插件真正需要的部分，去掉 build-face
 * （DSH_BUILD_FACE host/client 分面）、源码映射链、输入隔离那套仓库内部机制。
 *
 * 产物契约（与 dsh 宿主一致）：lib/client.js 是一个 closure-factory
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 * 宿主按 /plugins/<id>/client.js 提供；factory 的 require 只认宿主的模块表，
 * 表里没有的依赖必须内联进同一个文件。
 *
 * 样式：dsh client bundle 没有独立静态资源通道（宿主不提供 client.css），样式随
 * JS 走。*.module.css 由 lightningcss 编译成哈希类名映射并在 factory 执行时插
 * 一个带 data-plugin 标记的 <style>；*.css?inline 只给文本不注入（供 ui-css.ts
 * 那套 ensure*Style() 用）；其余普通 css 整段内联并注入。
 */
import { createRequire } from 'node:module'
import { builtinModules } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'

const require = createRequire(import.meta.url)

/** 本文件在仓库根 scripts/ 下，仓库根即它的上一级。 */
const REPOSITORY_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

/** Node 内置模块绝不允许混进浏览器模块表。 */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(id => `node:${id}`),
])

/** 浏览器端共享平台模块（与 dsh web 的 PLATFORM_MODULES 一致）。 */
export const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * 允许内联的 @deepseek-ai/* 白名单（官方 INLINE_SAFE 的等价物）：只放「线协议 /
 * 纯类型」层，它们没有需要跨插件共享的运行时身份。本仓库目前为空 —— 客户端代码
 * 对 @deepseek-ai/* 的引用只有平台模块和 import type，purity 门禁保持最严。
 */
export const INLINE_SAFE = /^$/

/** 虚拟 id 前缀：把 CSS 从 tsdown 自己的 css 管线里拽出来，后缀必须不是 .css。 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_INLINE_VIRTUAL_PREFIX = '\0dsh-css-inline:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

const manifestCache = new Map()

/**
 * 按包名找 package.json。
 *
 * 不能靠 process.cwd()：工作区里跑 tsdown 时 cwd 可能是仓库根（官方注释里明确写了
 * 这一点，所以它也是按包名 glob 找 manifest 的）。按名字找，谁调用都对。
 * @param {string} id - 插件 id，即 package.json 的 name。
 */
function packageManifest(id) {
  const cached = manifestCache.get(id)
  if (cached !== undefined) return cached
  const packagesDir = join(REPOSITORY_ROOT, 'packages')
  for (const entry of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, entry, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== id) continue
    manifestCache.set(id, manifest)
    return manifest
  }
  throw new Error(`tsdown: packages/*/package.json 里没有声明 ${id} 的包`)
}

/** 样式注入前言：module css 与普通 css 共用，先查标记再插，避免重复挂载插多次。 */
function injectTag(pluginId, fileId, cssText) {
  const tagId = `${pluginId}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ].join('\n')
}

/**
 * purity 门禁：宿主模块表之外的东西不许以值的形式 import 进浏览器产物。
 * 类型导入会被 TS 擦除，根本走不到这里；走到这里还带 @deepseek-ai/ 前缀的，
 * 就是跨插件的值依赖 —— 要么内联出第二份运行时实例，要么 require 不到，
 * 必须改走 cordis service。
 */
function purityGatePlugin(externals) {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + 'pick the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (externals.includes(source)) return null // 平台模块：外部化优先
      if (INLINE_SAFE.test(source)) return null // 线协议层：内联就是目的
      throw new Error(
        `client bundle purity: "${source}" is not a platform module (PLATFORM_MODULES / dsh.client.external) `
        + 'and not an inline-safe wire layer — cross-plugin value imports are forbidden; '
        + 'collaborate through cordis services (type-only imports are erased and never reach this gate)',
      )
    },
  }
}

/** CSS 虚拟模块插件：一个文件一个 <style data-plugin>，module css 另给类名映射。 */
function cssPlugin(pluginId) {
  return {
    name: 'dsh-css-inline',
    resolveId(source, importer) {
      const isInline = source.endsWith(`.css${INLINE_CSS_QUERY}`)
      const specifier = isInline ? source.slice(0, -INLINE_CSS_QUERY.length) : source
      if (!specifier.endsWith('.css')) return null
      // 相对/绝对路径按 importer 解；裸说明符（某个依赖自带的 css）按包解。
      let abs
      if (specifier.startsWith('.') || specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)) {
        abs = importer === undefined ? specifier : resolvePath(dirname(importer), specifier)
      } else {
        abs = require.resolve(specifier)
      }
      const prefix = isInline ? CSS_INLINE_VIRTUAL_PREFIX : CSS_VIRTUAL_PREFIX
      return prefix + abs + CSS_VIRTUAL_SUFFIX
    },
    load(virtualId) {
      const isInline = virtualId.startsWith(CSS_INLINE_VIRTUAL_PREFIX)
      const prefix = isInline ? CSS_INLINE_VIRTUAL_PREFIX : CSS_VIRTUAL_PREFIX
      if (!virtualId.startsWith(prefix)) return null
      const fileId = virtualId.slice(prefix.length, -CSS_VIRTUAL_SUFFIX.length)
      // 虚拟 id 会把物理文件藏出 rolldown 的 watch 图，这里补回去。
      this.addWatchFile(fileId)
      const source = readFileSync(fileId)
      // ?inline：只给文本，运行时由插件自己的 ensure*Style() 决定何时插。
      if (isInline) {
        const { code } = transform({ filename: fileId, code: source, minify: true })
        return `export default ${JSON.stringify(code.toString())};`
      }
      // *.module.css：哈希类名 + 编译后正文，正文随 <style> 注入。
      if (fileId.endsWith('.module.css')) {
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap = {}
        const entries = Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        for (const [local, exp] of entries) classMap[local] = exp.name
        return [
          injectTag(pluginId, fileId, code.toString()),
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      }
      // 其余普通 css：整段内联并注入，默认导出空串。
      const { code } = transform({ filename: fileId, code: source, minify: true })
      return [
        injectTag(pluginId, fileId, code.toString()),
        'export default "";',
      ].join('\n')
    },
  }
}

/**
 * 客户端产物（lib/client.js）。
 *
 * 与官方的一处**有意偏离**：minify 默认开。官方自己的产物不压缩（DSH 内置插件
 * 走应用内分发，未压缩方便排查），但我们的包是发 npm、由宿主从磁盘读出来发的，
 * 不压缩会让这个包从 76KB 涨到 850KB。要跟官方完全一致就传 { minify: false }。
 *
 * @param {string} id - 插件 id（package.json 的 name），烧进 __ModuleLoader__.load。
 * @param {object} [options]
 * @param {string[]} [options.external] - 额外平台模块；缺省读 manifest 的 dsh.client.external，回落 inject。
 * @param {string} [options.pluginVersion] - 烧进 __PLUGIN_VERSION__，缺省读 manifest 的 version。
 * @param {string} [options.entry] - 入口，缺省 src/client/index.ts（相对配置文件所在目录）。
 * @param {string} [options.outFile] - 产物文件名，缺省 client.js。
 * @param {boolean} [options.minify] - 是否压缩，缺省 true。
 * @param {boolean} [options.sourcemap] - 是否出源码映射，缺省 false。
 */
export function clientBundle(id, options = {}) {
  const manifest = packageManifest(id)
  const declared = manifest.dsh?.client?.external ?? manifest.dsh?.client?.inject ?? []
  const externals = [
    ...PLATFORM_MODULES,
    ...(options.external ?? declared).flatMap(module => [module, `${module}/client`]),
  ]
  const pluginVersion = options.pluginVersion ?? manifest.version
  const isRequested = specifier => externals.includes(specifier)
  const nodeEnv = process.env.NODE_ENV ?? 'production'
  return {
    name: `${id}/client`,
    entry: { client: options.entry ?? 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    // 类型由 tsc 出到 lib/types；这里的 dts 会把 banner/footer 一起包进 .d.cts。
    dts: false,
    minify: options.minify ?? true,
    sourcemap: options.sourcemap ?? false,
    // lib/ 里还有 tsc 的 lib/types，tsdown 不许清空。
    clean: false,
    deps: {
      // 模块表里有的留成 require；其余一律内联 —— require 不到的依赖就是运行时抛错。
      neverBundle: isRequested,
      alwaysBundle: specifier => !isRequested(specifier),
    },
    // CJS 输出会让部分传递依赖走 Node 入口（哪怕产物跑在浏览器里），
    // 显式保住 browser 条件导出；dual-mode 库按 NODE_ENV 选生产/开发分支。
    inputOptions: {
      resolve: {
        // 只有 main( CJS) + module(ESM) 两个字段、没有 exports 映射的老包
        // （lucide-react 就是），不写 mainFields 会落到 CJS 入口：965KB 的
        // dist/cjs/lucide-react.js 摇不掉树，一个图标把整包图标集带进来。
        // vite 的浏览器默认就是 ['browser','module',...]，这里对齐。
        mainFields: ['browser', 'module', 'main'],
        conditionNames: [
          nodeEnv === 'development' ? 'development' : 'production',
          'browser', 'import', 'module', 'default',
        ],
      },
    },
    // 内联进来的依赖会读 process.env.NODE_ENV 或探 import.meta.env.MODE，
    // CJS 产物里没有 import.meta，不替换就在 factory 执行时抛 ReferenceError。
    define: {
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'import.meta.env.MODE': JSON.stringify(nodeEnv),
      'import.meta.env': JSON.stringify({ MODE: nodeEnv }),
      __PLUGIN_VERSION__: JSON.stringify(pluginVersion),
    },
    plugins: [purityGatePlugin(externals), cssPlugin(id)],
    outputOptions: {
      entryFileNames: options.outFile ?? 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      // factory 的 require 只认宿主模块表，认不得相对 chunk 地址；dsh 也只提供
      // /plugins/<id>/client.js 一个文件。禁掉代码分割，动态 import() 一并内联。
      codeSplitting: false,
    },
  }
}

/**
 * host 产物（lib/index.js，ESM/node）。
 * @param {object} [options]
 * @param {string} [options.entry] - 入口，缺省 src/index.ts。
 */
export function hostBundle(options = {}) {
  return {
    entry: { index: options.entry ?? 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    // 关掉固定后缀：ESM 也输出 .js，package.json 的 main/exports 指向它就是。
    fixedExtension: false,
    dts: false,
    sourcemap: false,
    clean: false,
    // host 半跑在真实安装环境里：@deepseek-ai/* 全部留成 import。
    deps: {
      neverBundle: specifier => specifier.startsWith('@deepseek-ai/'),
      alwaysBundle: specifier => !specifier.startsWith('@deepseek-ai/'),
    },
  }
}