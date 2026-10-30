/**
 * plugin-agent-studio 的 tsdown 构建配置：
 * 一份 host 产物（lib/index.js）+ 一份 client 产物（lib/client.js）。
 *
 * 真正的构建契约在仓库根 scripts/tsdown.client.mjs；这里只声明「这个包叫什么」，
 * 版本号与 dsh.client.inject 由预设读本目录的 package.json 拿。
 */
import { clientBundle, hostBundle } from '../../scripts/tsdown.client.mjs'

export default [hostBundle(), clientBundle('@zzerx/dsh-plugin-agent-studio')]
