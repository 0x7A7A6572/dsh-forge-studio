/**
 * 图片静态资源导入声明：仓库根 scripts/tsdown.client.mjs 的 assetPlugin 把 .png
 * base64 内联进 lib/client.js —— client 闭包无外部资源通道，图必须随产物走。
 */
declare module '*.png' {
  const src: string
  export default src
}
