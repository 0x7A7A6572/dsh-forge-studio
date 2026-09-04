/**
 * notes-nav（便签板浮层弹窗导航）单测。
 * 每次测试用 createNotesNav 建独立实例，不污染模块级单例 notesNav。
 * 断言的不变式：
 * - 初态 = 列表页、无任何弹窗（editing=null、settingsOpen=false）；
 * - openEditor 打开编辑器弹窗并携带目标，且强制关闭设置弹窗；
 * - closeEditor 关编辑器弹窗；
 * - 弹窗互斥：setSettingsOpen(true) 会收掉编辑器弹窗；
 * - subscribe 在动作后触发、退订后不再触发。
 */

import { describe, expect, it } from 'vitest'
import type { NoteId, NoteRecord } from '../src/types.ts'
import { createNotesNav } from '../src/client/core/notes-nav.ts'
import type { EditorTarget } from '../src/client/core/notes-nav.ts'

function note(id: string): NoteRecord {
  return {
    id: id as NoteId,
    title: `标题 ${id}`,
    text: '正文',
    pinned: false,
    archived: false,
    color: 'yellow',
    origin: 'user',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('notes-nav 浮层弹窗导航', () => {
  it('初态：无弹窗（编辑器关、设置关）', () => {
    const nav = createNotesNav()
    expect(nav.editing).toBeNull()
    expect(nav.settingsOpen).toBe(false)
  })

  it('openEditor(create) 打开编辑器弹窗并携带 create 目标', () => {
    const nav = createNotesNav()
    nav.openEditor({ mode: 'create' })
    expect(nav.editing).toEqual({ mode: 'create' })
  })

  it('openEditor(edit) 携带目标便签快照', () => {
    const nav = createNotesNav()
    const target: EditorTarget = { mode: 'edit', note: note('n1') }
    nav.openEditor(target)
    expect(nav.editing).toEqual(target)
  })

  it('openEditor 强制关闭设置弹窗（弹窗互斥）', () => {
    const nav = createNotesNav()
    nav.setSettingsOpen(true)
    expect(nav.settingsOpen).toBe(true)
    nav.openEditor({ mode: 'create' })
    expect(nav.settingsOpen).toBe(false)
    expect(nav.editing).not.toBeNull()
  })

  it('setSettingsOpen(true) 强制关闭编辑器弹窗（弹窗互斥）', () => {
    const nav = createNotesNav()
    nav.openEditor({ mode: 'edit', note: note('n2') })
    nav.setSettingsOpen(true)
    expect(nav.editing).toBeNull()
    expect(nav.settingsOpen).toBe(true)
  })

  it('closeEditor 关闭编辑器弹窗', () => {
    const nav = createNotesNav()
    nav.openEditor({ mode: 'edit', note: note('n2') })
    nav.closeEditor()
    expect(nav.editing).toBeNull()
  })

  it('弹窗开关：动作触发订阅、退订后静默', () => {
    const nav = createNotesNav()
    const seen: string[] = []
    const off = nav.subscribe(() => seen.push('x'))
    nav.openEditor({ mode: 'create' })
    nav.closeEditor()
    expect(seen.length).toBe(2)
    off()
    nav.openEditor({ mode: 'create' })
    expect(seen.length).toBe(2)
  })

  it('设置弹窗开关不复活已关闭的编辑器弹窗', () => {
    const nav = createNotesNav()
    nav.openEditor({ mode: 'edit', note: note('n3') })
    nav.setSettingsOpen(true) // 互斥：编辑器被收掉
    nav.setSettingsOpen(false)
    expect(nav.editing).toBeNull()
    expect(nav.settingsOpen).toBe(false)
  })
})
