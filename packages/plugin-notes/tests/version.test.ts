/**
 * 插件版本号：构建时由 scripts/build.mjs 从 @zzerx/dsh-plugin-notes/package.json 注入（esbuild define）。
 * 这里只锁「注入值原样透出」与「没注入时不假装成正式版本」两条。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { pluginVersion } from '../src/version.ts'

describe('插件版本号', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没有注入值时回落 dev 标识，不假装成某个正式版本', () => {
    expect(pluginVersion()).toBe('0.0.0-dev')
  })

  it('构建注入的版本号原样返回', () => {
    vi.stubGlobal('__PLUGIN_VERSION__', '9.9.9')
    expect(pluginVersion()).toBe('9.9.9')
  })
})
