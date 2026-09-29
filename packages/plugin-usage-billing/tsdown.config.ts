/**
 * plugin-usage-billing 的 tsdown 构建配置：
 * 两份 host 产物（lib/index.js 是插件本体、lib/shape.js 是主题契约子路径）
 * 加一份 client 产物（lib/client.js）。
 *
 * 真正的构建契约在仓库根 scripts/tsdown.client.mjs。这里只声明「这个包叫什么、
 * 出哪几个入口」，版本号与 dsh.client.external 由预设读本包的 package.json 拿。
 */
import { clientBundle, hostBundle } from '../../scripts/tsdown.client.mjs'

export default [
  // esbuild 是**运行时**依赖（转译主题源码），必须留在产物外面：
  // 打进 lib/index.js 会把平台二进制塞进 ESM 产物里。
  hostBundle({ external: ['esbuild'] }),
  hostBundle({ entry: 'src/shape/index.ts', name: 'shape' }),
  clientBundle('@zzerx/dsh-plugin-usage-billing'),
]
