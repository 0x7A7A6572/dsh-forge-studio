/**
 * 读一个入口开关的当前值（设置命名空间 snapshot 叠加缺省表）。
 *
 * **只给 list 槽用**：关闭时组件返回 null —— 不注销槽位注册。这些位点带
 * `:empty { display: none }`，必须真返回 null，渲染空 div 会留下空白条。
 * 宿主自画外壳的位点（`sidebar.panellist`）不走这里，它按开关注销注册，
 * 见 types.ts 的 NotesEntryConfig。
 */

import { useSyncExternalStore } from 'react';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import { DEFAULT_NOTES_ENTRY_CONFIG } from '../../types.ts';
import type { NotesConfig, NotesEntryConfig } from '../../types.ts';

/**
 * @param scope - 本插件配置表单（NOTES_NAMESPACE，= profile 条目 id `zzerx-notes`）。
 * @param key - 入口开关字段名。
 * @returns 该入口是否启用（旧配置缺字段时回退缺省值）。
 */
export function useNotesEntryEnabled(
  scope: ConfigForm<NotesConfig>,
  key: keyof NotesEntryConfig,
): boolean {
  return useSyncExternalStore(
    (cb) => scope.subscribe(cb),
    () => scope.getSnapshot().value?.entry?.[key] ?? DEFAULT_NOTES_ENTRY_CONFIG[key],
  );
}
