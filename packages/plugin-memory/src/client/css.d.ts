/**
 * 样式文件的导入声明（plugin-memory）。
 *
 * *.css?inline —— vite 返回**编译后的 CSS 文本**且不自动注入，语义等价于原先
 * esbuild 的 `loader: { '.css': 'text' }`。运行时由 styles/settings-section.ts 的 ensure*Style()
 * 插成 <style>，因此作用域与回收时机仍由插件自己掌控。
 *
 * *.module.css —— vite 原生 CSS Modules：default 导出「局部类名 → 哈希类名」映射表，
 * 编译后的 CSS 由 vite-plugin-css-injected-by-js 在 factory 执行时插成 <style>。
 * 类名形态 [hash]_[local]，两个插件撞同名文件也不会撞类名。
 */
declare module '*.css?inline' {
  const css: string
  export default css
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
