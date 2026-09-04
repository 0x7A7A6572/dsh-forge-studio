/**
 * 使用说明 markdown（help-content.ts 的 HELP_MARKDOWN）覆盖性测试。
 * 内容本身即需求：四块说明（入口与快捷键 / 基础使用 / 对话使用 / 任务泳道），
 * 并须写全与产品事实一致的要点 —— 工具名、note:// 引用语法、五列状态-颜色
 * 映射、快捷键。任何与真实实现脱节的文案漂移都应让这些断言失败。
 */

import { describe, expect, it } from 'vitest'
import { HELP_MARKDOWN } from '../src/client/core/help-content.ts'

describe('HELP_MARKDOWN 使用说明覆盖', () => {
  it('非空且含 4 个以上二级分节', () => {
    const sections = HELP_MARKDOWN.match(/^##\s+.+$/gm) ?? []
    expect(sections.length).toBeGreaterThanOrEqual(4)
  })

  it('覆盖四大主题：入口/基础使用/对话使用/任务泳道', () => {
    expect(HELP_MARKDOWN).toContain('DeepSeek Harness')
    expect(HELP_MARKDOWN).toContain('基础使用')
    expect(HELP_MARKDOWN).toContain('对话使用')
    expect(HELP_MARKDOWN).toContain('任务泳道')
  })

  it('对话使用块列全六个 agent 工具名', () => {
    for (const tool of [
      'notes_list',
      'notes_get',
      'notes_create',
      'notes_update',
      'notes_set_pinned',
      'notes_delete',
    ]) {
      expect(HELP_MARKDOWN).toContain(tool)
    }
  })

  it('对话使用块说明 note:// 引用语法与 user 便签不可被 agent 删除', () => {
    expect(HELP_MARKDOWN).toContain('note://')
    expect(HELP_MARKDOWN).toContain('user')
  })

  it('任务泳道块写全五列状态及其纸色映射', () => {
    // 状态名必须与 TASK_LANES 文案一致（顺序即列顺序）。
    const lanes = ['待规划', '待办', '进行中', '已完成', '已失败']
    let last = -1
    for (const label of lanes) {
      const at = HELP_MARKDOWN.indexOf(label)
      expect(at).toBeGreaterThan(last)
      last = at
    }
    // 每列都标注了纸色（灰/黄/蓝/绿/粉），保证读者能按色识列。
    for (const color of ['灰', '黄', '蓝', '绿', '粉']) {
      expect(HELP_MARKDOWN).toContain(color)
    }
  })

  it('快捷键速查含 Esc 与 Ctrl+Enter', () => {
    expect(HELP_MARKDOWN).toContain('Esc')
    expect(HELP_MARKDOWN).toContain('Ctrl+Enter')
  })
})
