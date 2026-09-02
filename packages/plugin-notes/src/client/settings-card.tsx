/**
 * 便签设置卡片：编辑 forge-studio.notes 的 maxVisibleNotes / defaultTitle。
 * 通过 settings.plugin.item slot（key=命名空间）注入；命名空间不可用时渲染为空。
 * 编辑走本地暂存，保存时经 saveField 提交（host 校验 + 持久化 + 镜像刷新）。
 */

import { useState } from 'react'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 载入 settings-plugins 的 SlotMap 增广（settings.plugin.item），type-only。
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { NotesConfig } from '../types.ts'
import type { NotesCardFace, NotesField } from './notes-card-controller.ts'

export type NotesSettingsCardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<NotesCardFace>

const DEFAULT_TEXT: Record<NotesField, string> = {
  maxVisibleNotes: '8',
  defaultTitle: '新便签',
}

function fieldText(field: NotesField, snapshot: SettingsScopeSnapshot<NotesConfig>): string {
  const value = snapshot.value?.[field]
  return value === undefined ? DEFAULT_TEXT[field] : String(value)
}

export function NotesSettingsCard(props: NotesSettingsCardProps): JSX.Element | null {
  const snapshot = props.useNotesCard((s) => s)
  const [drafts, setDrafts] = useState<Partial<Record<NotesField, string>>>({})

  if (snapshot.status === 'unavailable') return null

  const draftOf = (field: NotesField): string =>
    drafts[field] ?? fieldText(field, snapshot)

  const dirty = (Object.keys(drafts) as NotesField[]).some(
    (field) => drafts[field] !== fieldText(field, snapshot),
  )

  function stage(field: NotesField, text: string): void {
    setDrafts((prev) => ({ ...prev, [field]: text }))
  }

  function clear(field: NotesField): void {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  async function save(): Promise<void> {
    const fields = (Object.keys(drafts) as NotesField[]).filter(
      (field) => drafts[field] !== fieldText(field, snapshot),
    )
    for (const field of fields) {
      await props.saveField(field, drafts[field] ?? '')
    }
    setDrafts({})
  }

  const disabled = !snapshot.writable
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
      <header>
        <h4 style={{ margin: 0 }}>便签（F1）</h4>
        <p style={{ margin: '2px 0 0', color: '#666', fontSize: 13 }}>便签板展示数量与默认标题</p>
      </header>
      <Field
        label="最多展示便签数"
        hint="便签板卡片里最多显示多少条便签"
        value={draftOf('maxVisibleNotes')}
        overridden={snapshot.user !== undefined && 'maxVisibleNotes' in (snapshot.user as object)}
        disabled={disabled}
        onChange={(text) => stage('maxVisibleNotes', text)}
        onReset={() => clear('maxVisibleNotes')}
      />
      <Field
        label="默认标题"
        hint="新建便签缺省标题"
        value={draftOf('defaultTitle')}
        overridden={snapshot.user !== undefined && 'defaultTitle' in (snapshot.user as object)}
        disabled={disabled}
        onChange={(text) => stage('defaultTitle', text)}
        onReset={() => clear('defaultTitle')}
      />
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button disabled={!dirty || disabled} onClick={() => setDrafts({})}>
          放弃
        </button>
        <button disabled={!dirty || disabled} onClick={() => void save()}>
          保存
        </button>
      </footer>
    </section>
  )
}

function Field(props: {
  label: string
  hint?: string
  value: string
  overridden: boolean
  disabled: boolean
  onChange: (text: string) => void
  onReset: () => void
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontWeight: 600 }}>
        {props.label}
        {props.overridden && <span style={{ color: '#c60', fontSize: 12, marginLeft: 6 }}>已覆盖</span>}
      </span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={props.value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', boxSizing: 'border-box' }}
        />
        <button disabled={props.disabled || !props.overridden} onClick={props.onReset}>
          重置
        </button>
      </span>
      {props.hint && <span style={{ color: '#888', fontSize: 12 }}>{props.hint}</span>}
    </label>
  )
}
