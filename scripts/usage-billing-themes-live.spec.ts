/**
 * 真实主题的冒烟门禁：本机 `$DSH_HOME/themes/usage-billing/line/` 存在时，
 * 它必须能被转译器编译成产物（guard 放行、JSX 走 jsx-runtime、自调 define）。
 * 不存在就跳过 —— 主题是用户私有的，仓库不替它兜底，也不留副本。
 */
import { describe, expect, it } from 'vitest'
import { discoverThemes, resolveThemesRoot } from '../packages/plugin-usage-billing/src/themes/discover.ts'
import { createThemeTranspiler } from '../packages/plugin-usage-billing/src/themes/transpile.ts'

const root = resolveThemesRoot()
const line = discoverThemes(root).find((theme) => theme.id === 'line')

// 跳过必须是**看得见**的一行：`pnpm test` 是裸 `vitest run`，本机 shell 里没有
// `DSH_HOME` 时 `resolveThemesRoot()` 会落到 `~/.dsh`；而仓库自己的脚本用的是
// `DSH_HOME=.dsh-home`（那里没有主题）。两条路径都不该让「静默 skip」看起来像「通过了」。
if (line === undefined) {
  console.log(
    `[live-gate] 跳过本机主题 line 门禁：${root} 下没有发现（可能是 DSH_HOME 与主题实际所在不一致）`,
  )
}

describe.skipIf(line === undefined)('本机主题 line', () => {
  it('能转译成自调 define 的产物', async () => {
    const js = await createThemeTranspiler().js(line!)
    expect(js).toContain('__usageBillingThemeHost.define("line"')
    expect(js).not.toContain('styles.')
  })

  it('styles.css 里的类名都带了前缀', async () => {
    const css = await createThemeTranspiler().css(line!)
    // 先去掉注释：`css()` 原样下发 styles.css，不剥注释，于是注释里写到的文件名
    // （`line-geometry.ts`）会被下面这个正则当成类选择器，报出假阳性 `.ts`。
    // 已知的接受边界（都是「正则扫文本」而非真解析 CSS 的代价，刻意不引入完整 CSS 解析器）：
    // - 声明值也会被扫：`background: url(bg.png)` 里的 `bg.png` 会冒出一个裸 `png` 假阳性。
    //   （本主题 styles.css 当前无 `url(`、字符串里无 `/*`、括号引号配对，故未触发。）
    // - 转义类名（`.\31 23`）、Unicode 类名（`.卡片`）、只出现在 `[class~="…"]` 里的类名都扫不到。
    // 三者都是用户自编主题才可能踩到的低概率情况，代价只是门禁多报/漏报一条，可接受。
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // 注意字符类里要带 `-`：`[a-zA-Z0-9]` 会在 `ub-line-card` 的连字符处截断，只抓到 `ub`。
    const classes = [...rules.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((match) => match[1]!)
    const bare = classes.filter((name) => !name.startsWith('ub-line-'))
    const prefixed = classes.filter((name) => name.startsWith('ub-line-'))
    // 阳性对照：`bare` 为空也可能是「压根没扫到类名」（注释写满的样式表、或正则日后回归）。
    // 先证明扫描确实看见了东西，`bare` 为空才有意义 —— 别让门禁变瞎。
    expect(prefixed.length).toBeGreaterThan(20)
    expect(bare).toEqual([])
  })
})
