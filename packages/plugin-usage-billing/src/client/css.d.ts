/**
 * 样式文件的导入声明（plugin-usage-billing）。
 *
 * *.module.css —— lightningcss 编译的 CSS Modules：default 导出「局部类名 → 哈希类名」映射表，
 * 编译后的 CSS 由 tsdown 预设的 CSS 插件在 factory 执行时插成 <style data-plugin>。
 * 类名形态 [hash]_[local]，两个插件撞同名文件也不会撞类名。
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
