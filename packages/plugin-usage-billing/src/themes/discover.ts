/**
 * 主题扫盘：`$DSH_HOME/themes/usage-billing/<id>/` 下有哪些主题。
 *
 * 三条都在这里定死，别处不再各判一遍：
 * - **id = 目录名**，必须匹配 {@link THEME_ID}；不合法的目录静默跳过（不报错，
 *   也不出现在设置页下拉里 —— 一个手滑的大写目录名不该让整块面板变红）。
 * - **入口固定 `index.tsx`**；没有它的目录不是主题。
 * - **样式固定 `styles.css`**，可选；主题没有 CSS Modules 可用（运行时装载拿不到构建期哈希）。
 *
 * 这里**不读文件内容**：label 在源码里，读它就得执行主题代码（见 route.ts 的注释）。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 主题 id 的白名单。目录名不匹配就直接跳过。 */
export const THEME_ID = /^[a-z0-9][a-z0-9-]*$/

/** 主题入口文件名。 */
export const THEME_ENTRY = 'index.tsx'

/** 主题可选样式文件名。 */
export const THEME_STYLE = 'styles.css'

/** 一个磁盘上的主题。三个路径都是绝对路径。 */
export interface ThemeSource {
  readonly id: string
  /** 主题目录（转译期用来判断相对 import 有没有越界）。 */
  readonly dir: string
  /** 入口文件 `index.tsx`。 */
  readonly entry: string
  /** `styles.css`；没有就是 undefined。 */
  readonly style: string | undefined
}

/**
 * 主题根目录：`$DSH_HOME/themes/usage-billing`。
 *
 * 刻意不用 `@deepseek-ai/dsh-home-paths`：那是 host 侧的内部包，从本插件解析它要多一条
 * 运行时依赖，而规则只有一句（`$DSH_HOME` 优先，空/未设回落 `~/.dsh`，与
 * `resolveDshHome` 的口径一致）。`DSH_HOME` 是相对路径时按相对路径用 —— `pnpm dev`
 * 就是 `.dsh-home`，那正是它想要的意思。
 */
export function resolveThemesRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim()
  const base = home === undefined || home === '' ? join(homedir(), '.dsh') : home
  return join(base, 'themes', 'usage-billing')
}

/** 扫一遍主题根目录。目录不存在 = 没有自定义主题，不是错误。 */
export function discoverThemes(root: string): readonly ThemeSource[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const found: ThemeSource[] = []
  for (const id of names.sort()) {
    if (!THEME_ID.test(id)) continue
    // 单个条目的 EACCES / TOCTOU 不许掀翻整次扫盘：坏目录跳过即可。
    try {
      const dir = join(root, id)
      const entry = join(dir, THEME_ENTRY)
      if (!existsSync(entry) || !statSync(entry).isFile()) continue
      const style = join(dir, THEME_STYLE)
      found.push({ id, dir, entry, style: existsSync(style) ? style : undefined })
    } catch {
      continue
    }
  }
  return found
}
