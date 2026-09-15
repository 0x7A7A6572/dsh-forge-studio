/**
 * 面板 UI 的静态渲染测试（新增/编辑弹窗 + 分段组按钮）。
 *
 * 仓库里没有 jsdom，所以这里用 react-dom/server 做静态渲染：能验证组件树不抛错、
 * 结构里确实是组按钮而不是下拉、锁定时带 disabled；不能验证点击交互（那需要 DOM）。
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'

// 宿主 UI 原语是浏览器包（lib 内含 .css），Node 里 import 会炸 —— 换成能透传
// children 的空壳，Modal 按 open 决定是否渲染 children。
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const Stub = (props: { children?: ReactNode }): ReactNode => props.children ?? null
  const Null = (): null => null
  return {
    Button: (props: { children?: ReactNode }) => createElement('button', null, props.children),
    Input: Null,
    Modal: (props: { open?: boolean; children?: ReactNode }) =>
      (props.open === true ? createElement('div', { role: 'dialog' }, props.children) : null),
    Pill: Stub,
    IconArchiveOutline20: Null,
    IconChecklistOutline14: Null,
    IconCopyOutline16: Null,
    IconDownloadOutline16: Null,
    IconEditOutline16: Null,
    IconLightOutline16: Null,
    IconListPenOutline16: Null,
    IconPlusOutline16: Null,
    IconRefreshOutline16: Null,
    IconTrashOutline16: Null,
  }
})

import { renderToStaticMarkup } from 'react-dom/server'
import {
  durationText,
  KIND_OPTIONS,
  MemoryDraftForm,
  MemorySection,
  ModalFeedback,
  ORIGIN_LABELS,
  SCOPE_OPTIONS,
  Segmented,
  sourceLabel,
  timeText,
} from '../src/client/views/section.tsx'

/** 渲染任意组件到静态 HTML。 */
function html(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

function renderSegmented(label: string, value: string | number, options: readonly { value: never; label: string }[]): string {
  return html(createElement(Segmented as never, { label, value, options, onChange: () => {} }))
}

const count = (text: string, needle: string): number => text.split(needle).length - 1

describe('分段组按钮（替代下拉）', () => {
  it('作用域渲染成 radiogroup + 两个 radio，选中项 aria-checked', () => {
    const out = renderSegmented('作用域', 'global', SCOPE_OPTIONS as never)
    expect(out).toContain('role="radiogroup"')
    expect(out).toContain('aria-label="作用域"')
    expect(count(out, 'role="radio"')).toBe(2)
    expect(count(out, 'aria-checked="true"')).toBe(1)
    expect(out).toContain('mem-seg-on')
    expect(out).not.toContain('<select')
  })

  it('分类 6 个选项是按钮', () => {
    expect(count(renderSegmented('分类', 'fact', KIND_OPTIONS as never), 'role="radio"')).toBe(6)
  })

  it('重要性是 5 档滑杆 + 底部中文等级描述，且不带 ★', () => {
    const out = html(createElement(MemoryDraftForm, {
      draft: { id: null, title: 't', content: 'c', kind: 'fact' as const, importance: 3, scope: 'global' as const, projectPath: '' },
      onChange: () => {},
    }))
    expect(out).toContain('type="range"')
    // ScaleSlider 按档位下标驱动：5 档 → min=0 / max=4，第 3 档落在下标 2
    expect(out).toContain('min="0"')
    expect(out).toContain('max="4"')
    expect(out).toContain('step="1"')
    expect(out).toContain('value="2"')
    expect(out).toContain('aria-label="重要性"')
    // 无障碍读数也走中文等级，不再是星号
    expect(out).toContain('aria-valuetext="普通（3/5）· 一般偏好与事实"')
    // 5 个刻点，当前档位及以下点亮
    expect(count(out, 'class="mem-tick')).toBe(5)
    expect(count(out, 'mem-tick-on')).toBe(3)
    expect(out).toContain('--mem-fill:50%')
    // 底部要有当前等级的「中文名 · 说明」
    expect(out).toContain('mem-slider-desc')
    expect(out).toContain('普通')
    expect(out).toContain('一般偏好与事实')
    // 用户明确要求：不要 ★ 那一套
    expect(out).not.toContain('★')
  })

  it('禁用态（锁定/忙碌）会落到按钮上', () => {
    const out = html(createElement(Segmented as never, {
      label: '作用域', value: 'global', options: SCOPE_OPTIONS, disabled: true, onChange: () => {},
    }))
    expect(count(out, 'disabled=""')).toBe(2)
  })
})

describe('弹窗结果提示', () => {
  it('有错误时在弹窗内可见（否则报错被弹窗挡住，看着像点了没反应）', () => {
    const out = html(createElement(ModalFeedback, { error: '导入失败：示例错误', notice: '' }))
    expect(out).toContain('mem-error')
    expect(out).toContain('role="alert"')
    expect(out).toContain('导入失败：示例错误')
  })

  it('无内容时不渲染任何节点', () => {
    expect(html(createElement(ModalFeedback, { error: '', notice: '' }))).toBe('')
  })
})

describe('新增 / 编辑表单', () => {
  const draft = { id: null, title: 't', content: 'c', kind: 'fact' as const, importance: 3, scope: 'global' as const, projectPath: '' }

  it('弹窗正文包含两组组按钮 + 一个滑杆 + 正文输入，且没有下拉', () => {
    const out = html(createElement(MemoryDraftForm, { draft, onChange: () => {} }))
    expect(count(out, 'role="radiogroup"')).toBe(2)
    expect(out).toContain('aria-label="作用域"')
    expect(out).toContain('aria-label="分类"')
    expect(out).toContain('aria-label="重要性"')
    expect(out).toContain('type="range"')
    expect(out).toContain('<textarea')
    expect(out).not.toContain('<select')
  })

  it('项目记忆才要求填工作区目录', () => {
    const globalOut = html(createElement(MemoryDraftForm, { draft, onChange: () => {} }))
    expect(globalOut).not.toContain('工作区目录')
    const projectOut = html(createElement(MemoryDraftForm, { draft: { ...draft, scope: 'project' as const }, onChange: () => {} }))
    expect(projectOut).toContain('工作区目录')
  })
})

describe('详情与沉淀面板', () => {
  /** SSR 不跑 useEffect，所以取数桩永远不被调用（返回空数组即可）。 */
  const memoryStub = {
    list: async () => ({ ok: true, value: [] }),
    getConfig: async () => ({ ok: true, value: {} }),
    stats: async () => ({ ok: true, value: null }),
    projects: async () => ({ ok: true, value: [] }),
    getConflicts: async () => ({ ok: true, value: [] }),
  }

  it('来源标签把内部 code 翻成人话', () => {
    expect(sourceLabel('agent')).toBe('模型工具')
    expect(sourceLabel('user')).toBe('面板手工')
    expect(sourceLabel('capture')).toBe('自动提炼')
    expect(sourceLabel('import')).toBe('导入')
    expect(sourceLabel('something-else')).toBe('something-else')
    expect(ORIGIN_LABELS.capture).toBe('对话提炼')
  })

  it('时间与耗时按可读格式展示', () => {
    expect(timeText(0)).toBe('—')
    expect(durationText(0)).toBe('—')
    expect(durationText(250)).toBe('250 ms')
    expect(durationText(2500)).toBe('2.5 s')
    expect(timeText(new Date(2026, 8, 14, 11, 1).getTime())).toBe('2026-09-14 11:01')
  })

  it('分区静态渲染：工具条有「沉淀」，弹窗未打开时不留内容', () => {
    const out = html(createElement(MemorySection as never, { close: () => {}, memory: memoryStub }))
    expect(out).toContain('生成对话记忆')
    expect(out).toContain('导入')
    expect(out).toContain('沉淀')
    expect(out).toContain('共 0 条')
    // 详情与沉淀面板都是 Modal(open=false)，SSR 里一个字符都不该出现
    expect(out).not.toContain('mem-raw-list')
    expect(out).not.toContain('mem-meta')
    expect(out).not.toContain('后台模型调用')
    // 高级块：标题与右侧 chevron 同在 summary 里，且默认收起
    expect(out).toContain('<details class="mem-advanced">')
    expect(out).toMatch(/<summary>[\s\S]*?高级 · 自动提炼[\s\S]*?mem-advanced-chevron[\s\S]*?<\/summary>/)
    expect(out).not.toContain('<details class="mem-advanced" open')
    // 高级块内部有自己的纵向间距容器（逐项 gap，不靠 margin 拼）
    expect(out).toMatch(/<div class="mem-advanced-body">[\s\S]*?aria-label="提炼间隔"[\s\S]*?助手回复也作为提炼素材/)
  })

  it('分区标题旁显示当前插件版本（显示构建注入的值，不是写死的）', () => {
    vi.stubGlobal('__PLUGIN_VERSION__', '9.9.9')
    try {
      const out = html(createElement(MemorySection as never, { close: () => {}, memory: memoryStub }))
      expect(out).toContain('class="mem-title-row"')
      expect(out).toMatch(/记忆<\/h2><span class="mem-version" title="插件版本">v9\.9\.9<\/span>/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
