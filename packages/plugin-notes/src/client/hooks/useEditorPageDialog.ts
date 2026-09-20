/**
 * 编辑器弹窗的本地状态：当前纸色。
 *
 * 独立成 hook 是因为视图文件里不许有 useState。纸色要跟着编辑目标切换（编辑 A →
 * 编辑 B / 新建）同步回初值，否则会沿用上一张便签的颜色。
 */

import { useEffect, useState } from 'react'
import { DEFAULT_NOTE_COLOR } from '../../types.ts'
import type { NoteColor } from '../../types.ts'
import type { EditorTarget } from '../core/notes-nav.ts'

export interface UseEditorPageDialogResult {
  /** 当前弹窗纸色（随底部取色器实时更新）。 */
  readonly paper: NoteColor
  readonly setPaper: (color: NoteColor) => void
}

/** 弹窗纸色初值：编辑带出便签既有色，新建默认黄。 */
function initialPaperOf(target: EditorTarget): NoteColor {
  return target.mode === 'edit' ? target.note.color : DEFAULT_NOTE_COLOR
}

export function useEditorPageDialog(target: EditorTarget): UseEditorPageDialogResult {
  const [paper, setPaper] = useState<NoteColor>(() => initialPaperOf(target))
  // 编辑目标切换（编辑 A → 编辑 B / 新建）时同步纸色初值，避免沿用上一张颜色。
  useEffect(() => {
    setPaper(initialPaperOf(target))
  }, [target])
  return { paper, setPaper }
}
