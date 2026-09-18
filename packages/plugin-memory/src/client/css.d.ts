/**
 * 样式模块的导入声明（plugin-memory）。
 *
 * '*.module.css' —— CSS Modules。类名由 vite 在编译期变成 [hash:base64:6]_[local]
 * （规则在仓库根 scripts/vite.client.mjs），运行时拿到的是「源码类名 → 编译后类名」的对象。
 *
 * 注入由 vite-plugin-css-injected-by-js 在 bundle 执行时插成 <style>，
 * 所以插件里不再需要 ensureXxxStyle() 这种手动 injector。
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
