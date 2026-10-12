/**
 * 内置「无」主题：和峰谷环那张卡一样，只是不画左侧那张图。
 * 只想看金额与预算条、不要小图时选它。
 */
import type { Theme, ThemeProps } from '../../shape/index.ts'
import { EntryShell } from './entry-shell.tsx'

export const BUILTIN_NONE_THEME_ID = 'builtin-none'

export function BuiltinNoneTheme(props: ThemeProps): JSX.Element {
  return <EntryShell themeId={BUILTIN_NONE_THEME_ID} view={props.view} chart={null} />
}

export const builtinNoneTheme: Theme = {
  id: BUILTIN_NONE_THEME_ID,
  label: '内置：无峰谷图',
  component: BuiltinNoneTheme,
}
