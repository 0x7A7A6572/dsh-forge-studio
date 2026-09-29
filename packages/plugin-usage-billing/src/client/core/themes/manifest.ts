/**
 * 主题清单（`GET /usage-billing/themes/manifest.json`）的校验。
 *
 * 校验存在的理由：这份 JSON 由宿主下发，而宿主可能是**旧版本**（没有这条路由、
 * 或者字段形状不同）。装载器宁可少一个主题，也不能在渲染路径上抛。
 * 单条坏行丢掉，整体不是对象/`themes` 不是数组才抛 —— 那说明路由根本不是我们的。
 */

/** 路由前缀，与 host 侧 `src/themes/route.ts` 的 `THEMES_ROUTE_PATH` 一致。 */
export const THEMES_ROUTE_PATH = '/usage-billing/themes'

/** 清单 URL。 */
export const THEME_MANIFEST_URL = `${THEMES_ROUTE_PATH}/manifest.json`

export interface ThemeManifestRow {
  readonly id: string
  readonly url: string
  readonly cssUrl?: string
}

export interface ThemeManifestBroken {
  readonly id: string
  readonly reason: string
}

export interface ThemeManifest {
  readonly themes: readonly ThemeManifestRow[]
  readonly broken: readonly ThemeManifestBroken[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rowOf(value: unknown): ThemeManifestRow | undefined {
  if (!isRecord(value)) return undefined
  const { id, url, cssUrl } = value
  if (typeof id !== 'string' || id === '' || typeof url !== 'string' || url === '') return undefined
  return typeof cssUrl === 'string' && cssUrl !== '' ? { id, url, cssUrl } : { id, url }
}

function brokenOf(value: unknown): ThemeManifestBroken | undefined {
  if (!isRecord(value)) return undefined
  const { id, reason } = value
  if (typeof id !== 'string' || typeof reason !== 'string') return undefined
  return { id, reason }
}

/** 解析清单。形状完全不对就抛（调用方会把它记成一条失败）。 */
export function parseThemeManifest(value: unknown): ThemeManifest {
  if (!isRecord(value)) throw new Error('主题清单不是对象（宿主可能是旧版本）')
  const { themes, broken } = value
  if (!Array.isArray(themes)) throw new Error('主题清单缺少 themes 数组')
  return {
    themes: themes.map(rowOf).filter((row): row is ThemeManifestRow => row !== undefined),
    broken: (Array.isArray(broken) ? broken : [])
      .map(brokenOf)
      .filter((row): row is ThemeManifestBroken => row !== undefined),
  }
}
