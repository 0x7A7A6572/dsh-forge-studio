/**
 * 样式正文（*.css）的导入声明。
 *
 * build.mjs 用 esbuild `loader: { '.css': 'text' }` 把 .css 文件当纯文本打进
 * lib/client.js —— default 导出就是文件全文，运行时由 ui-css.ts 里的 ensure*Style()
 * 注入 <style>。dsh client bundle 没有独立静态资源通道，样式必须随闭包产物走，
 * 因此这里只声明「导入即拿到字符串」，不存在 CSS Modules 之类的对象形态。
 */
declare module '*.css' {
  const css: string
  export default css
}
