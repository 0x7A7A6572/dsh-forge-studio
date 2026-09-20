/**
 * 工作报告 · 模板页：卡片栅格 + 卡片脚操作（编辑 / 设为默认 / 删除），
 * 末尾虚线「新增模板」；弹窗（编辑 / 预览两段式模板）走宿主 Modal 原语。
 */

import { useState } from 'react'
import {
  Button, IconCheckOutline14, IconEditOutline16, IconPlusOutline16, IconTrashOutline16,
  Input, MarkdownText, Modal, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DailyLogRemote } from '../core/remote.ts'
import type { TemplateRecord } from '../../types.ts'
import {  joinTemplate, parseTemplate } from '../../template.ts'
import { AddButton, DialogRoot, IconAction, errText } from './parts.tsx'

/** MarkdownText 本地化文案（模板预览用，引用稳定常量）。 */
const MD_LABELS = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** 模板摘要：取骨架段的前几个章节标题（去掉 Markdown 标记）做卡片说明。 */
function templateSummary(content: string): string {
  const parsed = parseTemplate(content)
  const lines = parsed.skeletonSection
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return '骨架段为空'
  const head = lines.slice(0, 4).join(' · ')
  return head.length > 96 ? head.slice(0, 96) + '…' : head
}

/** 模板页。 */
export function TemplatesView(props: {
  dailyLog: DailyLogRemote
  templates: readonly TemplateRecord[]
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
}): JSX.Element {
  const [dialog, setDialog] = useState<{ editing: TemplateRecord | null } | null>(null)

  return (
    <div className="dl-pane">
      {props.templates.length === 0
        ? <p className="dl-empty">还没有模板。模板决定报告的章节结构：指令段可选，骨架段必填。</p>
        : (
          <>
            <h3 className="dl-group-head">模板</h3>
            <ul className="dl-cards">
              {props.templates.map((t) => (
                <li key={t.id} className="dl-card">
                  <div className="dl-card-body">
                    <div className="dl-card-head">
                      <span className="dl-card-name" title={t.name}>{t.name}</span>
                      {t.isBuiltin && <Pill>内置</Pill>}
                      {t.isDefault && <Pill active>默认</Pill>}
                    </div>
                    <span className="dl-card-desc dl-clamp" title={templateSummary(t.content)}>
                      {templateSummary(t.content)}
                    </span>
                  </div>
                  {!t.isBuiltin && (
                    <div className="dl-card-foot">
                      <IconAction
                        label="编辑模板"
                        icon={<IconEditOutline16 size={16} />}
                        onClick={() => { setDialog({ editing: t }) }}
                      />
                      {!t.isDefault && (
                        <IconAction
                          label="设为默认"
                          disabled={props.busy}
                          icon={<IconCheckOutline14 size={16} />}
                          onClick={() => void props.run(async () => {
                            const res = await props.dailyLog.setDefaultTemplate(t.id)
                            if (!res.ok) throw new Error(errText(res.error))
                          })}
                        />
                      )}
                      <IconAction
                        label="删除模板"
                        danger
                        disabled={props.busy}
                        icon={<IconTrashOutline16 size={16} />}
                        onClick={() => void props.run(async () => {
                          const res = await props.dailyLog.deleteTemplate(t.id)
                          if (!res.ok) throw new Error(errText(res.error))
                        })}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      <AddButton
        label="新增模板"
        icon={<IconPlusOutline16 size={16} />}
        disabled={props.busy}
        onClick={() => { setDialog({ editing: null }) }}
      />
      {dialog !== null && (
        <TemplateEditDialog
          dailyLog={props.dailyLog}
          busy={props.busy}
          run={props.run}
          editing={dialog.editing}
          onClose={() => { setDialog(null) }}
        />
      )}
    </div>
  )
}

/** 新增 / 编辑模板弹窗：编辑段与预览段同一份草稿。 */
function TemplateEditDialog(props: {
  dailyLog: DailyLogRemote
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
  editing: TemplateRecord | null
  onClose: () => void
}): JSX.Element {
  const initial = props.editing !== null ? parseTemplate(props.editing.content) : null
  const [name, setName] = useState(props.editing?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.promptSection ?? '')
  const [skeleton, setSkeleton] = useState(initial?.skeletonSection ?? '')
  const [preview, setPreview] = useState(false)

  async function save(): Promise<void> {
    if (name.trim() === '' || skeleton.trim() === '') return
    const content = joinTemplate(prompt, skeleton)
    await props.run(async () => {
      const res =
        props.editing !== null
          ? await props.dailyLog.updateTemplate(props.editing.id, { name: name.trim(), content })
          : await props.dailyLog.createTemplate({ name: name.trim(), content })
      if (!res.ok) throw new Error(errText(res.error))
      props.onClose()
    })
  }

  const canSave = !props.busy && name.trim() !== '' && skeleton.trim() !== ''

  return (
    <Modal
      open
      onClose={props.onClose}
      title={props.editing !== null ? '编辑模板' : '新增模板'}
      closeLabel="关闭"
      description={''/* '指令段（可选） + ' + DATA_MARKER + ' + 骨架段；内容作为结构引导喂给生成 AI。' */}
      className="dl-dialog-md"
      footer={(
        <>
          <Button variant="outline" onClick={props.onClose}>取消</Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {props.editing !== null ? '保存' : '创建'}
          </Button>
        </>
      )}
    >
      <DialogRoot>
        <div className="dl-field-row" style={{ alignItems: 'center' }}>
          <Input
            className="dl-grow"
            placeholder="模板名"
            value={name}
            onChange={(event) => { setName(event.target.value) }}
          />
          <div className="dl-seg">
            <button
              type="button"
              className={preview ? 'dl-seg-btn' : 'dl-seg-btn dl-seg-btn-active'}
              onClick={() => { setPreview(false) }}
            >
              编辑
            </button>
            <button
              type="button"
              className={preview ? 'dl-seg-btn dl-seg-btn-active' : 'dl-seg-btn'}
              onClick={() => { setPreview(true) }}
            >
              预览
            </button>
          </div>
        </div>
        {preview
          ? (
            <>
              <div className="dl-field">
                <span className="dl-field-label">
                  指令段（可选）预览{prompt.trim() === '' ? ' —— 未填写' : ''}
                </span>
                {prompt.trim() !== '' && (
                  <div className="dl-preview">
                    <MarkdownText text={prompt} labels={MD_LABELS} />
                  </div>
                )}
              </div>
              <div className="dl-field">
                <span className="dl-field-label">骨架段（必填）预览</span>
                <div className="dl-preview dl-preview-tall">
                  <MarkdownText text={skeleton} labels={MD_LABELS} />
                </div>
              </div>
            </>
          )
          : (
            <>
              <div className="dl-field">
                <textarea
                  className="dl-textarea dl-textarea-prompt"
                  placeholder={'指令段（可选）：给生成 AI 的额外撰写要求，如「按周维度组织，每周一个小节」'}
                  value={prompt}
                  onChange={(event) => { setPrompt(event.target.value) }}
                />
              </div>
              <div className="dl-divider">骨架段（报告章节结构，必填）</div>
              <textarea
                className="dl-textarea dl-textarea-skeleton"
                placeholder={'章节标题，示例：\n## 核心产出\n## 问题修复\n## 技术优化\n## 其他工作\n## 下一步计划'}
                value={skeleton}
                onChange={(event) => { setSkeleton(event.target.value) }}
              />
            </>
          )}
      </DialogRoot>
    </Modal>
  )
}
