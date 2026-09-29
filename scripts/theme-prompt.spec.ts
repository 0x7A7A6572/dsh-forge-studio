/**
 * 提示词 ↔ 契约 的交叉门禁。
 *
 * 这段提示词是给**别的 AI** 读的规格书，它写错一个字段名，AI 就会照着一个不存在的
 * `view.xxx` 写完一整个包。所以这里不能只断言「提示词里出现过这些词」（那只挡住删除），
 * 必须**反过来**拿提示词承诺的每个标识符去契约源码里核对：契约改名而提示词没跟上 → 红。
 *
 * 注意断言用的是词边界：`over` 不能靠 `overview` 蒙过去，`id` 不能靠 `BUILTIN_THEME_ID` 蒙过去。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_PROMPT_TOKENS, themePrompt } from '../packages/plugin-usage-billing/src/client/themes/theme-prompt.ts'
import { SHAPE_SPECIFIER } from '../packages/plugin-usage-billing/src/shape/index.ts'

/** 契约源码：提示词里说的每个东西，这里必须真的有。 */
const CONTRACT_SOURCE = readFileSync(
  new URL('../packages/plugin-usage-billing/src/shape/contract.ts', import.meta.url),
  'utf8',
)

const IDEA = '金额是主体，峰/谷只用一个圆点'

describe('themePrompt', () => {
  it('拒绝空输入 —— 没有「画成什么样」就不生成提示词', () => {
    expect(() => themePrompt('')).toThrow()
    expect(() => themePrompt('   ')).toThrow()
    expect(() => themePrompt('\n\t ')).toThrow()
  })

  it('把用户那句「画成什么样」原样放进最后一节', () => {
    const prompt = themePrompt(`  ${IDEA}  `)
    expect(prompt).toContain('## 画成什么样')
    expect(prompt.trimEnd().endsWith(IDEA)).toBe(true)
  })

  it('讲清了怎么写一个主题文件：放哪里 + 导出什么 + 能 import 什么', () => {
    const prompt = themePrompt(IDEA)
    for (const needle of [
      '$DSH_HOME/themes/usage-billing',
      'export const theme',
      'label',
      'component',
      SHAPE_SPECIFIER,
    ]) {
      expect(prompt).toContain(needle)
    }
  })
})

describe('提示词与契约不许漂移', () => {
  it('token 清单没有重复（重复只会让门禁更难读）', () => {
    expect(new Set(THEME_PROMPT_TOKENS).size).toBe(THEME_PROMPT_TOKENS.length)
  })

  it('提示词真的写了清单里的每个 token', () => {
    const prompt = themePrompt(IDEA)
    const missing = THEME_PROMPT_TOKENS.filter((token) => !prompt.includes(token))
    expect(missing).toEqual([])
  })

  it('清单里的每个 token 都能在契约源码里找到（契约改名而提示词没跟上就红）', () => {
    const missing = THEME_PROMPT_TOKENS.filter(
      (token) => !new RegExp(`\\b${token}\\b`).test(CONTRACT_SOURCE),
    )
    expect(missing).toEqual([])
  })
})
