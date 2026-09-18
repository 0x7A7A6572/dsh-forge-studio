/** 本页面专属零件：记忆草稿表单（新增 / 编辑共用）。 */

import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { SCOPE_OPTIONS, KIND_OPTIONS, IMPORTANCE_STEPS, importanceLevelAt } from '../../../core/memory-model.ts'
import type { Draft } from '../../../core/memory-section-types.ts'
import { ScaleSlider } from '../../../components/ScaleSlider.tsx'
import { Segmented } from '../../../components/Segmented.tsx'

/** 草稿表单（新增 / 编辑共用，渲染在弹窗里）。模块级组件，便于单测直接渲染。 */
export function MemoryDraftForm(props: {
  draft: Draft
  disabled?: boolean
  onChange: (next: Draft) => void
}): JSX.Element {
  const current = props.draft
  const setDraft = props.onChange
  
    return (
      <div className="mem-modal-body" data-dsh-memory-ui="">
        <div className="mem-draft-form">
          <Input
            value={current.title}
            placeholder="标题（同作用域下同名会自动合并）"
            onChange={(event) => { setDraft({ ...current, title: event.currentTarget.value }) }}
          />
          <Input
            value={current.summary}
            placeholder="摘要（可选，一行说清这条讲什么）"
            onChange={(event) => { setDraft({ ...current, summary: event.currentTarget.value }) }}
          />
          <Input
            value={current.aliases}
            placeholder="别名（可选，用 / 、 或逗号分隔）"
            onChange={(event) => { setDraft({ ...current, aliases: event.currentTarget.value }) }}
          />
          <Segmented
            label="作用域"
            value={current.scope}
            options={SCOPE_OPTIONS}
            onChange={(scope) => {
              setDraft({ ...current, scope, projectPath: scope === 'project' ? current.projectPath : '' })
            }}
          />
          {current.scope === 'project' && (
            <div className="mem-field-row">
              <span>工作区目录</span>
              <Input
                list="mem-project-options"
                value={current.projectPath}
                placeholder="工作区绝对路径"
                onChange={(event) => { setDraft({ ...current, projectPath: event.currentTarget.value }) }}
              />
            </div>
          )}
          <Segmented
            label="分类"
            value={current.kind}
            options={KIND_OPTIONS}
            onChange={(kind) => { setDraft({ ...current, kind }) }}
          />
          <div className="mem-seg-row">
            <span className="mem-seg-label">重要性</span>
            <ScaleSlider
              label="重要性"
              value={current.importance}
              steps={IMPORTANCE_STEPS}
              disabled={props.disabled === true}
              describe={(value) => {
                const level = importanceLevelAt(value)
                return <><b>{level.label}</b>{' · '}{level.desc}</>
              }}
              valueText={(value) => {
                const level = importanceLevelAt(value)
                return level.label + '（' + value + '/5）· ' + level.desc
              }}
              onChange={(importance) => { setDraft({ ...current, importance }) }}
            />
          </div>
          <textarea
            value={current.content}
            placeholder="记忆正文（用你原本的表述，写清「什么时候该这么做」）"
            onChange={(event) => { setDraft({ ...current, content: event.currentTarget.value }) }}
          />
        </div>
      </div>
    )
  }
