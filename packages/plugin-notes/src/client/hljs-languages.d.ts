/**
 * highlight.js 语言文法子路径的类型声明（highlight.js 包未为
 * lib/languages/* 提供类型；lowlight 的 register 接收 LanguageFn）。
 * 运行解析走 esbuild 的 node 子路径解析（exports 里 ./lib/languages/*），
 * 与类型无关。
 */
declare module 'highlight.js/lib/languages/powershell' {
  import type { LanguageFn } from 'lowlight'
  const language: LanguageFn
  export default language
}
declare module 'highlight.js/lib/languages/dos' {
  import type { LanguageFn } from 'lowlight'
  const language: LanguageFn
  export default language
}
declare module 'highlight.js/lib/languages/xml' {
  import type { LanguageFn } from 'lowlight'
  const language: LanguageFn
  export default language
}
