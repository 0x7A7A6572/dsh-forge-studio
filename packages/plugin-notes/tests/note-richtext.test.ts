/**
 * 编辑器富文本扩展装配（note-richtext / code-languages）纯逻辑单测：
 * - 语言候选表覆盖用户要求的基础语言（html/js/css/bash/ps/bat/vue/react/ts/python），
 *   value 唯一、'' = 无语言，label 一一对应；
 * - lowlight 实例能对候选值精确高亮（含 jsx/tsx/vue/ps/bat 等别名），
 *   未注册语言判定 false（退化为自动识别，不会让 tiptap 抛错）。
 * 本组测试只触碰语法注册与判定函数，不实例化 tiptap Editor（无 DOM）。
 */

import { describe, expect, it } from 'vitest'
import { CODE_LANGUAGES, CODE_LANGUAGE_NONE, isCodeLanguageOption } from '../src/client/core/code-languages.ts'
import {
  isCodeLanguageHighlightable,
  noteLowlight,
} from '../src/client/core/note-richtext.ts'

const REQUIRED_BASIC_LANGUAGES = ['html', 'js', 'css', 'bash', 'ps', 'bat', 'vue', 'ts', 'python'] as const

describe('code-languages 语言候选表', () => {
  it('第一项恒为「无语言」（空 value）', () => {
    expect(CODE_LANGUAGES[0]).toEqual(CODE_LANGUAGE_NONE)
    expect(CODE_LANGUAGE_NONE.value).toBe('')
    expect(CODE_LANGUAGE_NONE.label).toBe('无语言')
  })

  it('覆盖基础语言集，且 value/label 成对唯一', () => {
    const values = CODE_LANGUAGES.map((o) => o.value)
    const labels = CODE_LANGUAGES.map((o) => o.label)
    expect(values).toHaveLength(new Set(values).size)
    expect(labels).toHaveLength(new Set(labels).size)
    for (const lang of REQUIRED_BASIC_LANGUAGES) {
      expect(values).toContain(lang)
    }
    // React 写作 jsx/tsx（走 javascript/typescript 别名）
    expect(values).toContain('jsx')
    expect(values).toContain('tsx')
  })

  it('isCodeLanguageOption 覆盖全部候选（含空串），拒绝未知', () => {
    for (const o of CODE_LANGUAGES) {
      expect(isCodeLanguageOption(o.value)).toBe(true)
    }
    expect(isCodeLanguageOption('ruby')).toBe(false)
  })
})

describe('note-richtext 语法高亮注册表', () => {
  it('候选语言（含别名）都能被精确高亮', () => {
    const cases = ['html', 'js', 'jsx', 'ts', 'tsx', 'vue', 'css', 'bash', 'ps', 'bat', 'python', 'json', 'yaml', 'sql', 'xml', 'markdown', 'diff', 'ini', 'javascript', 'typescript', 'powershell', 'dos', 'shell']
    for (const lang of cases) {
      expect(isCodeLanguageHighlightable(lang), `should highlight ${lang}`).toBe(true)
    }
  })

  it('空/未知语言判定 false（走自动识别，不抛错）', () => {
    expect(isCodeLanguageHighlightable('')).toBe(false)
    expect(isCodeLanguageHighlightable(null)).toBe(false)
    expect(isCodeLanguageHighlightable(undefined)).toBe(false)
    expect(isCodeLanguageHighlightable('ruby-not-registered')).toBe(false)
    expect(isCodeLanguageHighlightable('no-such-language')).toBe(false)
  })

  it('挂载的 registered 钩子（tiptap 装饰判定用）与公开判定一致', () => {
    expect(noteLowlight.registered('js')).toBe(true)
    expect(noteLowlight.registered('vue')).toBe(true)
    expect(noteLowlight.registered('zz-not-real')).toBe(false)
  })

  it('listLanguages 包含补注册的语言与 common 基础集', () => {
    const list = noteLowlight.listLanguages()
    for (const name of ['javascript', 'typescript', 'css', 'python', 'xml', 'powershell', 'dos', 'vue']) {
      expect(list).toContain(name)
    }
  })
})
