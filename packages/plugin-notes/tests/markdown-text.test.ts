/**
 * markdown-text 纯函数单测：摘要/纯文本提取只做显示降级，绝不抛错。
 */

import { describe, expect, it } from 'vitest'
import { mdSnippet, mdToPlainText, firstImageUrl } from '../src/client/core/markdown-text.ts'

describe('mdToPlainText', () => {
  it('去掉粗体/斜体/删除线标记', () => {
    expect(mdToPlainText('**加粗** 与 *斜体* 与 ~~删除线~~')).toBe('加粗 与 斜体 与 删除线')
  })

  it('链接取文字、图片取 alt、行内代码去反引号', () => {
    expect(mdToPlainText('看 [文档](https://a.b/c) 与 `const x = 1`')).toBe('看 文档 与 const x = 1')
    expect(mdToPlainText('图：![截图](a.png)')).toBe('图：截图')
  })

  it('标题/引用/列表标记全部去掉', () => {
    const md = ['# 标题', '> 引用行', '- 无序项', '1. 有序项', '- [x] 已完成项'].join('\n')
    expect(mdToPlainText(md)).toBe('标题 引用行 无序项 有序项 已完成项')
  })

  it('代码块去掉围栏但保留内容', () => {
    expect(mdToPlainText('```ts\nconst a = 1\n```')).toBe('const a = 1')
  })

  it('多段文本折叠为单空格', () => {
    expect(mdToPlainText('第一段\n\n第二段\n第三段')).toBe('第一段 第二段 第三段')
  })

  it('空输入返回空串、纯文本原样返回', () => {
    expect(mdToPlainText('')).toBe('')
    expect(mdToPlainText('  纯文本  ')).toBe('纯文本')
  })

  it('剥掉 <img> HTML 标签', () => {
    expect(mdToPlainText('看图 <img src="x.png" width="50%"> 这里')).toBe('看图 这里')
  })
})

describe('mdSnippet', () => {
  it('短内容不截断', () => {
    expect(mdSnippet('**hello** world')).toBe('hello world')
  })

  it('超长内容按 maxLength 截断并追加省略号', () => {
    const out = mdSnippet('a'.repeat(200), 50)
    expect(out).toHaveLength(51)
    expect(out.endsWith('…')).toBe(true)
  })

  it('CJK 截断不产生半个字符', () => {
    const out = mdSnippet('便'.repeat(100), 10)
    expect(out).toBe('便'.repeat(10) + '…')
  })
})

describe('firstImageUrl', () => {
  it('取 data URL 首图', () => {
    const md = '文字 ![截图](data:image/png;base64,AAAA) 后文\n\n![另一张](data:image/png;base64,BBBB)'
    expect(firstImageUrl(md)).toBe('data:image/png;base64,AAAA')
  })

  it('无图返回 null', () => {
    expect(firstImageUrl('纯文本 **加粗** [链接](https://a.b)')).toBeNull()
    expect(firstImageUrl('')).toBeNull()
  })

  it('只取正文第一张（多行多图）', () => {
    const md = '- ![一](a.png)\n- ![二](b.png)'
    expect(firstImageUrl(md)).toBe('a.png')
  })

  it('支持 title 后缀与空格', () => {
    expect(firstImageUrl('![图](http://x/y.png "标题")')).toBe('http://x/y.png')
    expect(firstImageUrl('![图]( http://x/y.png )')).toBe('http://x/y.png')
  })

  it('识别内联 HTML <img>（设过尺寸的图）', () => {
    expect(firstImageUrl('<img src="data:image/png;base64,AAAA" width="50%" />')).toBe('data:image/png;base64,AAAA')
  })

  it('HTML 与 markdown 混排时取最早出现者', () => {
    expect(firstImageUrl('文字 ![图](a.png) 与 <img src="b.png">')).toBe('a.png')
    expect(firstImageUrl('文字 <img src="b.png"> 后 ![图](a.png)')).toBe('b.png')
  })

  it('src 不在首位的 <img> 也能识别', () => {
    expect(firstImageUrl('<img width="50%" src="c.png">')).toBe('c.png')
  })
})
