/**
 * dsh 客户端插件的共享 vite 构建预设。
 *
 * 产物契约（与 dsh 宿主一致）：lib/client.js 是一个 closure-factory
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 * 宿主按 /plugins/<id>/client.js 提供；factory 收到的 require 由宿主的模块表应答
 * （PLATFORM_MODULES），插件之间不共享任何模块级全局。
 *
 * 样式：dsh client bundle 没有独立静态资源通道（宿主不提供 client.css），样式必须
 * 随 JS 闭包产物走，所以这里挂 vite-plugin-css-injected-by-js，由它在 factory 执行
 * 时把 CSS 插成 <style>。*.module.css 另由 vite 原生编译成哈希类名映射。
 *
 * 本文件放在仓库根：ESM 的裸说明符按「导入方文件所在位置」解析，本文件在根，所以
 * 'vite' 这些构建期依赖只在根的 package.json 声明一次，三个包共用。
 */
import { build as viteBuild } from 'vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'

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
 * 构建一个插件的客户端产物。
 * @param {object} options
 * @param {string} options.root - 插件包根目录。
 * @param {string} options.id - 插件 id（package.json 的 name），烧进 __ModuleLoader__.load。
 * @param {string} options.version - 插件版本，烧进 __PLUGIN_VERSION__（见 src/version.ts）。
 * @param {string[]} [options.inject] - package.json 的 dsh.client.inject 声明的额外平台模块。
 */
export async function buildClient({ root, id, version, inject = [] }) {
  const external = [
    ...PLATFORM_MODULES,
    ...inject.flatMap(module => [module, `${module}/client`]),
  ]

  await viteBuild({
    configFile: false,
    root,
    // vite 默认清屏，会把 pnpm -r build 的日志冲掉。
    clearScreen: false,
    build: {
      outDir: 'lib',
      // lib/ 里还有 tsc 与 tsup 的产物，不能让 vite 清空。
      emptyOutDir: false,
      target: 'es2022',
      minify: 'esbuild',
      sourcemap: false,
      lib: {
        entry: 'src/client/index.ts',
        formats: ['cjs'],
        fileName: () => 'client.js',
      },
      rollupOptions: {
        external,
        output: {
          // echarts 这类依赖内部用动态 import()；lib 模式默认按 chunk 拆文件，而宿主
          // 只提供 /plugins/<id>/client.js，且 factory 的 require 是宿主的模块表而非
          // 文件系统 —— 拆出去的 chunk 既送不到浏览器也 require 不到，必须内联成单文件。
          inlineDynamicImports: true,
          banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
          intro: 'var module = { exports: {} }; var exports = module.exports;',
          footer: 'return module.exports; } });',
          assetFileNames: 'client.[ext]',
        },
      },
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __PLUGIN_VERSION__: JSON.stringify(version),
    },
    css: {
      modules: {
        // [hash]_[local]：哈希在前，两个插件撞同名文件也不会撞类名。
        generateScopedName: '[hash:base64:6]_[local]',
      },
    },
    plugins: [cssInjectedByJs({
      // 默认 true 会把注入 IIFE 顶到 banner **之前**，bundle 就不再以
      // window.__ModuleLoader__.load( 开头。设 false 让它留在 factory 内部，
      // 既保住「文件第一句就是注册」的契约，又跟原来手动 injector 的时机一致。
      topExecutionPriority: false,
    })],
  })
}
