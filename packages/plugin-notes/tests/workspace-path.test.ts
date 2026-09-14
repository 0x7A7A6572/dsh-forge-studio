/**
 * 工作区路径展示辅助测试：下拉只显示文件夹名（同名冲突才补父目录），
 * 反斜杠/正斜杠、尾随分隔符、根路径等边界都要稳。
 */

import { describe, expect, it } from 'vitest'
import {
  folderNameOf,
  parentFolderNameOf,
  workspaceLabels,
  workspaceSelectOptions,
} from '../src/client/core/workspace-path.ts'

describe('folderNameOf / parentFolderNameOf', () => {
  it('取末段文件夹名，兼容两种分隔符与尾随分隔符', () => {
    expect(folderNameOf('D:\\codes\\my-app')).toBe('my-app')
    expect(folderNameOf('D:/codes/other-app/')).toBe('other-app')
    expect(folderNameOf('/home/u/proj')).toBe('proj')
    expect(folderNameOf('D:\\')).toBe('D:')
    expect(folderNameOf('   D:/a/b   ')).toBe('b')
  })

  it('父目录名取倒数第二段；没有父段返回空串', () => {
    expect(parentFolderNameOf('D:\\codes\\my-app')).toBe('codes')
    expect(parentFolderNameOf('D:/codes/other-app/')).toBe('codes')
    expect(parentFolderNameOf('/proj')).toBe('')
    expect(parentFolderNameOf('')).toBe('')
  })
})

describe('workspaceLabels（下拉标签）', () => {
  it('名字互不冲突时只给文件夹名', () => {
    const labels = workspaceLabels(['D:\\codes\\my-app', '/home/u/notes'])
    expect(labels.get('D:\\codes\\my-app')).toBe('my-app')
    expect(labels.get('/home/u/notes')).toBe('notes')
  })

  it('同名冲突时补父目录段，保证标签唯一可辨', () => {
    const labels = workspaceLabels(['D:\\a\\src', 'D:\\b\\src', 'D:\\c\\app'])
    expect(labels.get('D:\\a\\src')).toBe('a/src')
    expect(labels.get('D:\\b\\src')).toBe('b/src')
    expect(labels.get('D:\\c\\app')).toBe('app')
  })

  it('空列表返回空表', () => {
    expect(workspaceLabels([]).size).toBe(0)
  })
})

describe('workspaceSelectOptions（下拉选项集）', () => {
  it('候选 + 只给文件夹名的标签', () => {
    expect(workspaceSelectOptions(['D:\\codes\\my-app', 'D:\\codes\\other'], '')).toEqual([
      { path: 'D:\\codes\\my-app', label: 'my-app' },
      { path: 'D:\\codes\\other', label: 'other' },
    ])
  })

  it('当前值不在候选里时追加（否则一进编辑器旧值会被静默改掉）', () => {
    const options = workspaceSelectOptions(['D:\\codes\\my-app'], 'D:\\legacy\\old-proj')
    expect(options.map((o) => o.path)).toEqual(['D:\\codes\\my-app', 'D:\\legacy\\old-proj'])
    expect(options[1]?.label).toBe('old-proj')
  })

  it('当前值已在候选里则不重复；空值不占选项（由「用默认」承担）', () => {
    expect(workspaceSelectOptions(['D:\\a'], 'D:\\a').map((o) => o.path)).toEqual(['D:\\a'])
    expect(workspaceSelectOptions(['D:\\a'], '   ').map((o) => o.path)).toEqual(['D:\\a'])
  })

  it('同名候选按父目录段消歧', () => {
    const options = workspaceSelectOptions(['D:\\x\\src', 'D:\\y\\src'], '')
    expect(options.map((o) => o.label)).toEqual(['x/src', 'y/src'])
  })
})
