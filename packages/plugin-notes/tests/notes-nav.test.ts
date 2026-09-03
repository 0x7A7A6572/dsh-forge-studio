/**
 * notes-nav（便签板内部状态路由）单测。
 * 每次测试用 createNotesNav 建独立实例，不污染模块级单例 notesNav。
 * 断言的路由不变式：
 * - 初态 = board、设置弹窗关；
 * - openEditor 进入 editor 并携带 draft，且强制关闭设置弹窗；
 * - closeEditor 回 board；
 * - 设置弹窗开/关与页面正交（editor 页可随 openEditor 关闭）；
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
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('notes-nav 状态路由', () => {
  it('初态：board 页、设置弹窗关', () => {
    const nav = createNotesNav()
    expect(nav.route).toEqual({ page: 'board' })
    expect(nav.settingsOpen).toBe(false)
  })

  it('openEditor(create) 进入 editor 并携带 create draft', () => {
    const nav = createNotesNav()
    nav.openEditor({ mode: 'create' })
    expect(nav.route).toEqual({ page: 'editor', draft: { mode: 'create' } })
  })

  it('openEditor(edit) 携带目标便签快照', () => {
    const nav = createNotesNav()
    const target: EditorTarget = { mode: 'edit', note: note('n1') }
    nav.openEditor(target)
    expect(nav.route.page).toBe('editor')
    if (nav.route.page === 'editor') {
      expect(nav.route.draft).toEqual(target)
    }
  })

  it('openEditor 强制关闭设置弹窗（编辑页无齿轮）', () => {
    const nav = createNotesNav()
    nav.setSettingsOpen(true)
    expect(nav.settingsOpen).toBe(true)
    nav.openEditor({ mode: 'create' })
    expect(nav.settingsOpen).toBe(false)
  })

  it('closeEditor 回 board 页', () => {
    const nav = createNotesNav()
    nav.openEditor({ mode: 'edit', note: note('n2') })
    nav.closeEditor()
    expect(nav.route).toEqual({ page: 'board' })
  })

  it('设置弹窗开/关：动作触发订阅、退订后静默', () => {
    const nav = createNotesNav()
    const seen: string[] = []
    const off = nav.subscribe(() => seen.push('x'))
    nav.setSettingsOpen(true)
    nav.setSettingsOpen(false)
    expect(nav.settingsOpen).toBe(false)
    expect(seen.length).toBe(2)
    off()
    nav.setSettingsOpen(true)
    expect(seen.length).toBe(2)
  })

  it('路由不因开关弹窗而丢失（设置弹窗与页面正交）', () => {
    const nav = createNotesNav()
    nav.openEditor({ mode: 'edit', note: note('n3') })
    expect(nav.route.page).toBe('editor')
    nav.closeEditor()
    nav.setSettingsOpen(true)
    expect(nav.route).toEqual({ page: 'board' })
    expect(nav.settingsOpen).toBe(true)
  })
})
