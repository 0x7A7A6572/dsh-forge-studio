/**
 * 图片静态资源导入声明：仓库根 scripts/tsdown.client.mjs 的 assetPlugin 把
 * .png/.webp/.jpg/.gif/.svg base64 内联进 lib/client.js —— dsh client bundle
 * 无外部静态资源通道，图片必须随闭包产物走，运行时不会再有 <img src> 的相对路径请求。
 * 栅格源图体积敏感（内联 = 约 4/3 字节），入库前先优化（见 .research/image-opt）。
 */
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.webp' {
  const src: string
  export default src
}
