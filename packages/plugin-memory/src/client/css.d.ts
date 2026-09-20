/**
 * 样式模块的导入声明（plugin-memory）。
 *
 * '*.module.css' —— CSS Modules。类名由 lightningcss 在编译期变成 [hash]_[local]
 * （规则在仓库根 scripts/tsdown.client.mjs），运行时拿到的是「源码类名 → 编译后类名」的对象。
 *
 * 注入由根 scripts/tsdown.client.mjs 的 CSS 插件在 factory 执行时插成 <style data-plugin>，
 * 所以插件里不再需要 ensureXxxStyle() 这种手动 injector。
 */

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
