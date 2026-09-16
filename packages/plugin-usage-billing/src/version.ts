/**
 * 插件版本号：打包客户端时由 scripts/build.mjs 从 package.json 注入
 * （esbuild define 的 __PLUGIN_VERSION__），package.json 是唯一真源。
 *
 * 源码直跑 / vitest 环境没有这层注入，此时回落 dev 标识 —— 宁可显示「未知版本」，
 * 也不在这里手写一个迟早会和 package.json 漂移的字面量。
 */

declare const __PLUGIN_VERSION__: string

/** 当前构建的插件版本，形如 `0.1.0`；未注入时为 `0.0.0-dev`。 */
export function pluginVersion(): string {
  return typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '0.0.0-dev'
}
