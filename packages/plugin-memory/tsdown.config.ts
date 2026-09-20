/**
 * plugin-memory 的 tsdown 构建配置：
 * 一份 host 产物（lib/index.js）+ 一份 client 产物（lib/client.js）。
 *
 * 真正的构建契约在仓库根 scripts/tsdown.client.mjs（移植自官方
 * packages/client/tsdown.client.ts）—— 这里只声明「这个包叫什么」，
 * 版本号与 dsh.client.inject 由预设读本目录的 package.json 拿。
 *
 * 必须在包根目录下运行（pnpm run build 即是）：入口与输出目录都按 cwd 解析。
 */
import { clientBundle, hostBundle } from '../../scripts/tsdown.client.mjs'

export default [hostBundle(), clientBundle('@zzerx/dsh-plugin-memory')]
