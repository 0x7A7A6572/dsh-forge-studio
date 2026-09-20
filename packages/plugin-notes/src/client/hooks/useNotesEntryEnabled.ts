/**
 * 读一个入口开关的当前值（设置命名空间 snapshot 叠加缺省表）。
 *
 * 视图只拿 boolean：关闭时组件返回 null —— **不是**注销槽位注册。理由见
 * types.ts 的 NotesEntryConfig：这些位置都带 `:empty { display: none }`，
 * 必须真返回 null，渲染空 div 会留下空白条。
 */

import { useSyncExternalStore } from 'react';
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client';
import { DEFAULT_NOTES_ENTRY_CONFIG } from '../../types.ts';
import type { NotesConfig, NotesEntryConfig } from '../../types.ts';

/**
 * @param scope - forge-studio-notes 命名空间 scope。
 * @param key - 入口开关字段名。
 * @returns 该入口是否启用（旧配置缺字段时回退缺省值）。
 */
export function useNotesEntryEnabled(
  scope: SettingsScope<NotesConfig>,
  key: keyof NotesEntryConfig,
): boolean {
  return useSyncExternalStore(
    (cb) => scope.subscribe(cb),
    () => scope.getSnapshot().value?.entry?.[key] ?? DEFAULT_NOTES_ENTRY_CONFIG[key],
  );
}
