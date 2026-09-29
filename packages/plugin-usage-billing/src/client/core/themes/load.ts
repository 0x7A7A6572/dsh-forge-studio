/**
 * 按清单装载主题。
 *
 * 三个副作用（拉 JSON、插 `<script>`、插 `<link>`）**全部注入**：这样这段逻辑能在
 * node 里被完整测到，而 `hooks/theme-runtime.ts` 只需要提供三个 DOM 实现。
 *
 * 失败隔离是这里的主要职责：一个主题挂了不能影响别的，也不能让调用方抛 ——
 * 设置页那条「为什么我的主题没生效」就靠 `reject` 收到的原因。
 *
 * 装载成功**不认 `onload`**：脚本执行完还要用 `hasLanded` 复查它到底注册没有（经典脚本
 * 顶层抛错也触发 `onload`）。没有这一步，那类主题就是「列表里少一个、别处一个字都不说」。
 *
 * 注意这里**没有**「拿到主题」的回调：脚本执行时自己调宿主的 `define`，主题从
 * `installThemeHost` 的 `onTheme` 那条路进集合。多一条交付路径就多一处可能不一致。
 */
import { THEME_MANIFEST_URL, parseThemeManifest } from './manifest.ts'
import type { ThemeManifest } from './manifest.ts'
import { THEME_MANIFEST_FAILURE_ID } from './failures.ts'

export interface LoadThemesOptions {
  /** 缺省 `THEME_MANIFEST_URL`。 */
  readonly manifestUrl?: string
  readonly fetchJson: (url: string) => Promise<unknown>
  /** 插一段经典脚本并等它执行完（`onload` / `onerror`）。 */
  readonly loadScript: (url: string) => Promise<void>
  /** 插一条样式表。 */
  readonly loadStyle: (url: string) => void
  /** 记一条失败（清单坏了、或某个主题装载失败）。 */
  readonly reject: (id: string, reason: string) => void
  /**
   * 这个 id 是否已经有了着落：**注册成功，或者已经被拒**（那样失败名单里已经有一条更具体的
   * 原因）。返回 `false` 就说明脚本跑完了却什么都没注册。
   *
   * 为什么「已被拒」也算着落：被拒的主题同样不在 registry 里，若这里只查 registry，下面那条
   * 通用原因会把 `define` 给的**具体**原因盖掉（失败 store 按 id 去重，后写的顶掉先写的）。
   */
  readonly hasLanded: (id: string) => boolean
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 拉清单 → 处理 broken → 逐个装载。本函数**不抛**。 */
export async function loadThemes(options: LoadThemesOptions): Promise<void> {
  const url = options.manifestUrl ?? THEME_MANIFEST_URL
  let manifest: ThemeManifest
  try {
    manifest = parseThemeManifest(await options.fetchJson(url))
  } catch (error) {
    options.reject(THEME_MANIFEST_FAILURE_ID, `主题清单读取失败：${describe(error)}`)
    return
  }
  for (const broken of manifest.broken) options.reject(broken.id, broken.reason)
  for (const row of manifest.themes) {
    // 样式是**可选装饰**：它失败不该让这个主题消失（它仍然可选，只是没上色），更不该把后面的
    // 主题一起带走。所以单独吞掉，且**刻意不记失败行** —— 主题能用的时候多一行只是噪音。
    // 必须与下面那段脚本的 catch 分开：那个 catch 会记一条「装载失败」，会把「只是没样式」
    // 说成「装不上」，用户按那条原因去查是查不到的。
    try {
      if (row.cssUrl !== undefined) options.loadStyle(row.cssUrl)
    } catch {
      // 有意吞掉：理由见上。
    }
    try {
      await options.loadScript(row.url)
    } catch (error) {
      options.reject(row.id, `装载 ${row.url} 失败：${describe(error)}`)
      // 已经记过更具体的原因了，别再往下走到后置检查（那会用通用原因把它盖掉）。
      continue
    }
    // `onload` 只说明脚本「执行完了」，不说明它**注册成功**：经典脚本顶层抛错时照样触发
    // `onload`（`onerror` 只管加载失败），于是主题悄无声息地消失。注册是结果，不是事件的
    // 副产品 —— 这里把「脚本跑完了，registry 里却没有这个 id」当成一条失败记下来。
    if (options.hasLanded(row.id)) continue
    options.reject(
      row.id,
      `主题脚本 ${row.url} 执行完却没有注册主题 "${row.id}"：` +
        '脚本可能在顶层就抛错了（语法没问题但执行失败）。原始错误只在浏览器控制台里' +
        '（window.onerror），这里看不到它的堆栈。',
    )
  }
}
