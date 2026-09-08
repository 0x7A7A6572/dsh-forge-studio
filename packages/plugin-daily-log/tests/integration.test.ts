import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitChannel } from '../src/sources/git.ts'
import { DEFAULT_TEMPLATE_SKELETON, parseTemplate } from '../src/template.ts'

const here = dirname(fileURLToPath(import.meta.url))
// packages/plugin-daily-log/tests → workspace root 上溯三层
const workspaceRoot = resolve(here, '..', '..', '..')

describe('端到端：git 扫描（workspace 真实仓库）', () => {
  it('gitChannel 能收集到 commit 条目', async () => {
    const entries = await gitChannel.scan({ path: workspaceRoot, label: 'dsh-desk-studio', range: { since: '2020-01-01' } })
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.kind === 'commit')).toBe(true)
    expect(entries[0].sourceLabel).toBe('dsh-desk-studio')
    expect(entries[0].title).toBeTruthy()
  })
})

describe('默认模板（LLM 引导骨架）', () => {
  it('骨架含五节、无 mustache、整份视为骨架', () => {
    const parts = parseTemplate(DEFAULT_TEMPLATE_SKELETON)
    expect(parts.promptSection).toBeNull()
    expect(parts.skeletonSection).toContain('## 核心产出')
    expect(parts.skeletonSection).not.toContain('{{')
  })
})
