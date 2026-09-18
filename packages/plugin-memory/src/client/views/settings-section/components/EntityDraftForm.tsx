/** 本页面专属零件：实体草稿表单（新建 / 编辑共用）。 */

import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { ENTITY_KIND_OPTIONS } from '../../../core/memory-model.ts'
import type { EntityDraft } from '../../../core/memory-section-types.ts'
import { Segmented } from '../../../components/Segmented.tsx'

/** 实体表单（新建 / 编辑共用，渲染在弹窗里）。模块级组件，便于单测直接渲染。 */
export function EntityDraftForm(props: {
  draft: EntityDraft
  disabled?: boolean
  onChange: (next: EntityDraft) => void
}): JSX.Element {
  const current = props.draft
  const setDraft = props.onChange
  return (
    <div className="mem-modal-body" data-dsh-memory-ui="">
      <div className="mem-draft-form">
        <Input
          value={current.name}
          placeholder="名称（同名或同别名会自动并入已有实体）"
          onChange={(event) => { setDraft({ ...current, name: event.currentTarget.value }) }}
        />
        <Segmented
          label="类别"
          value={current.kind}
          options={ENTITY_KIND_OPTIONS}
          disabled={props.disabled === true}
          onChange={(kind) => { setDraft({ ...current, kind }) }}
        />
        <Input
          value={current.aliases}
          placeholder="别名（可选，用 / 、 或逗号分隔）"
          onChange={(event) => { setDraft({ ...current, aliases: event.currentTarget.value }) }}
        />
        <Input
          value={current.summary}
          placeholder="一行说明（可选）"
          onChange={(event) => { setDraft({ ...current, summary: event.currentTarget.value }) }}
        />
      </div>
    </div>
  )
}
