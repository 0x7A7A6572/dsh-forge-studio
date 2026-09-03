/**
 * 便签设置卡片控制器：持有 forge-studio.notes 命名空间的 SettingsScope，
 * 把字段写入翻译成 scope.set/unset（host 校验 + 持久化），并把 scope 本身
 * 作为卡片 Hook 源（getSnapshot/subscribe 与 slot 机制同构）。
 */

import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotesConfig } from '../../types.ts'

/** 可编辑字段。 */
export type NotesField = 'maxVisibleNotes' | 'defaultTitle'

/** 卡片 slot 条目注入面：hooks 里的 notesCard 成为 useNotesCard；saveField 直通。 */
export interface NotesCardFace {
  /** 提交一个字段（空字符串 = 清除回默认）。 */
  saveField(field: NotesField, text: string): Promise<void>
  hooks: {
    notesCard: SettingsScope<NotesConfig>
  }
}

export class NotesCardController {
  constructor(private readonly scope: SettingsScope<NotesConfig>) {}

  inject(): NotesCardFace {
    const scope = this.scope
    return {
      hooks: { notesCard: scope },
      async saveField(field, text) {
        const trimmed = text.trim()
        if (field === 'maxVisibleNotes') {
          if (trimmed === '') {
            await scope.unset('maxVisibleNotes')
            return
          }
          const n = Number(trimmed)
          if (!Number.isFinite(n)) return
          await scope.set('maxVisibleNotes', Math.floor(n))
          return
        }
        if (trimmed === '') {
          await scope.unset('defaultTitle')
          return
        }
        await scope.set('defaultTitle', trimmed)
      },
    }
  }
}
