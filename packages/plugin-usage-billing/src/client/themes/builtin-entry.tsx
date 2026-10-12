/**
 * 内置「峰谷环」主题：左侧 12 小时峰谷环（一天两圈），右侧金额与预算条。
 * 它同时是「怎么写一个主题」的参考实现：不 import 宿主 hook、不自己判档、只用契约给的数据。
 * 外壳（盒子、金额、预算条）在 entry-shell.tsx，这里只画中间那张图。
 */
import type { Theme, ThemeProps } from '../../shape/index.ts'
import { BUILTIN_THEME_ID } from '../../shape/index.ts'
import { TierCurveMini } from '../components/TierCurveMini.tsx'
import { visualTone } from '../core/tier-curve.ts'
import { EntryShell } from './entry-shell.tsx'

export function BuiltinEntryTheme(props: ThemeProps): JSX.Element {
  const { data, view } = props
  const chart = view.showTier && data !== null
    ? <TierCurveMini profile={data} minute={data.minute} tone={visualTone(data.tone)} />
    : null
  return <EntryShell themeId={BUILTIN_THEME_ID} view={view} chart={chart} />
}

export const builtinEntryTheme: Theme = {
  id: BUILTIN_THEME_ID,
  label: '内置：峰谷环 + 金额',
  component: BuiltinEntryTheme,
}
