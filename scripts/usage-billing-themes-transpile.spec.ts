/**
 * 主题转译的门禁。这里钉的是**主题 ABI 的边界**，不是实现细节：
 * 1. 扫盘只认 `<id>/index.tsx` 齐、且 id 合法的目录；其余静默跳过。
 * 2. 允许的裸 import 映射到 require（不内联），产物能被执行且自调 define。
 * 3. 白名单外的裸 import、以及主题目录之外的文件，必须在**转译期**报错 ——
 *    漏过去就是浏览器里一个看不懂的 require 失败。判定按**真实路径**做：symlink / NTFS
 *    junction 能把目录外的文件挂进主题目录，字符串判定看不见。
 * 4. 缓存按 mtime+size 失效：改了文件再请求必须拿到新产物 —— 包括**依赖文件**，不只入口。
 * 5. 相对 import 按 esbuild 的解析规则来：缺扩展名（`./geometry`）与目录（`./sub` → `sub/index.tsx`）
 *    都算「主题目录内的文件」。
 * 6. stamp 只走主题自己的文件：`node_modules` 不进（guard 不许产物依赖它），条目数还有上限 ——
 *    单次请求的成本不随主题目录里躺着的无关子树规模增长。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverThemes, resolveThemesRoot } from '../packages/plugin-usage-billing/src/themes/discover.ts'
import { createThemeTranspiler } from '../packages/plugin-usage-billing/src/themes/transpile.ts'
import type { ThemeTranspiler } from '../packages/plugin-usage-billing/src/themes/transpile.ts'

let root = ''

function theme(id: string, source: string): void {
  mkdirSync(join(root, id), { recursive: true })
  writeFileSync(join(root, id, 'index.tsx'), source, 'utf8')
}

const OK = `import { useState } from 'react'
export const theme = { label: '示例', component: () => useState(0)[0] }
`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ub-themes-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('扫盘', () => {
  it('只认 index.tsx 齐、且目录名合法的主题，按 id 排序', () => {
    theme('b-second', OK)
    theme('a-first', OK)
    mkdirSync(join(root, 'no-entry'), { recursive: true })
    mkdirSync(join(root, 'Bad_Id'), { recursive: true })
    writeFileSync(join(root, 'Bad_Id', 'index.tsx'), OK, 'utf8')
    expect(discoverThemes(root).map((t) => t.id)).toEqual(['a-first', 'b-second'])
  })

  it('目录不存在返回空数组，不抛', () => {
    expect(discoverThemes(join(root, 'missing'))).toEqual([])
  })

  it('styles.css 存在才有 style', () => {
    theme('styled', OK)
    writeFileSync(join(root, 'styled', 'styles.css'), '.x{}', 'utf8')
    expect(discoverThemes(root)[0]?.style).toBe(join(root, 'styled', 'styles.css'))
    theme('plain', OK)
    expect(discoverThemes(root).find((t) => t.id === 'plain')?.style).toBeUndefined()
  })
})

describe('主题根目录', () => {
  it('$DSH_HOME 优先，空串回落 ~/.dsh', () => {
    expect(resolveThemesRoot({ DSH_HOME: 'D:/h' })).toBe(join('D:/h', 'themes', 'usage-billing'))
    expect(resolveThemesRoot({ DSH_HOME: '  ' })).toMatch(/[\\/]\.dsh[\\/]themes[\\/]usage-billing$/)
  })
})

describe('转译', () => {
  it('允许的裸 import 变成 require（没被内联），产物是自调 define 的 IIFE', async () => {
    theme('ok', OK)
    const js = await createThemeTranspiler().js(discoverThemes(root)[0]!)
    // require 的目标必须**只有**白名单里的那几个：多一个就说明有东西被内联进来了。
    const required = [...js.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]!)
    expect([...new Set(required)]).toEqual(['react'])
    expect(js).toContain('var module = { exports: {} }')
    expect(js).toContain('__usageBillingThemeHost.define("ok"')
  })

  it('JSX 走 react/jsx-runtime', async () => {
    theme('jsx', `export const theme = { label: 'x', component: () => <b>hi</b> }
`)
    const js = await createThemeTranspiler().js(discoverThemes(root)[0]!)
    expect(js).toContain('require("react/jsx-runtime")')
  })

  it('白名单外的裸 import 报错', async () => {
    theme('bad', `import x from 'lodash'
export const theme = { label: 'x', component: () => x }
`)
    await expect(createThemeTranspiler().js(discoverThemes(root)[0]!)).rejects.toThrow(/lodash/)
  })

  it('主题目录之外的文件报错', async () => {
    writeFileSync(join(root, 'outside.ts'), 'export const x = 1', 'utf8')
    theme('escaping', `import { x } from '../outside.ts'
export const theme = { label: 'x', component: () => x }
`)
    await expect(createThemeTranspiler().js(discoverThemes(root)[0]!)).rejects.toThrow(/目录之外/)
  })

  it('主题自己的多文件可以 import', async () => {
    mkdirSync(join(root, 'multi'), { recursive: true })
    writeFileSync(join(root, 'multi', 'geometry.ts'), 'export const K = 41\n', 'utf8')
    writeFileSync(
      join(root, 'multi', 'index.tsx'),
      `import { K } from './geometry.ts'
export const theme = { label: 'x', component: () => K }
`,
      'utf8',
    )
    const js = await createThemeTranspiler().js(discoverThemes(root)[0]!)
    expect(js).toContain('41')
  })

  it('缓存按 mtime 失效', async () => {
    theme('cached', OK)
    const transpiler = createThemeTranspiler()
    const first = await transpiler.js(discoverThemes(root)[0]!)
    writeFileSync(join(root, 'cached', 'index.tsx'), OK.replace('示例', '改过'), 'utf8')
    const past = new Date(Date.now() + 2000)
    utimesSync(join(root, 'cached', 'index.tsx'), past, past)
    const second = await transpiler.js(discoverThemes(root)[0]!)
    expect(second).toContain('改过')
    expect(second).not.toBe(first)
  })
  it('主题目录在扫盘之后消失：报「主题目录读不到」而不是裸 ENOENT', async () => {
    theme('vanishing', OK)
    const source = discoverThemes(root)[0]!
    rmSync(source.dir, { recursive: true, force: true })
    await expect(createThemeTranspiler().js(source)).rejects.toThrow(/主题目录读不到/)
  })
})

describe('缓存覆盖依赖文件', () => {
  it('只改被 import 的依赖文件（入口字节不变）也必须拿到新产物', async () => {
    mkdirSync(join(root, 'deps'), { recursive: true })
    writeFileSync(join(root, 'deps', 'dep.ts'), `export const V = 'ONE'\n`, 'utf8')
    writeFileSync(
      join(root, 'deps', 'index.tsx'),
      `import { V } from './dep.ts'
export const theme = { label: V, component: () => V }
`,
      'utf8',
    )
    const transpiler = createThemeTranspiler()
    const first = await transpiler.js(discoverThemes(root)[0]!)
    expect(first).toContain('ONE')

    // 只动依赖文件，入口一个字节都没改 —— 旧实现（只 stamp 入口）会命中旧产物。
    // mtime 推后是为了规避「同尺寸 + 同毫秒」这种 FileSystem 分辨率上的偶然相等。
    writeFileSync(join(root, 'deps', 'dep.ts'), `export const V = 'TWO'\n`, 'utf8')
    const future = new Date(Date.now() + 2000)
    utimesSync(join(root, 'deps', 'dep.ts'), future, future)
    const second = await transpiler.js(discoverThemes(root)[0]!)
    expect(second).toContain('TWO')
    expect(second).not.toBe(first)

    // 再把入口的 mtime 往回拨：任何「取最新 mtime」式的实现都不许因此漏掉依赖的改动。
    const older = new Date(Date.now() - 60_000)
    utimesSync(join(root, 'deps', 'index.tsx'), older, older)
    writeFileSync(join(root, 'deps', 'dep.ts'), `export const V = 'THREE'\n`, 'utf8')
    const later = new Date(Date.now() + 4000)
    utimesSync(join(root, 'deps', 'dep.ts'), later, later)
    const third = await transpiler.js(discoverThemes(root)[0]!)
    expect(third).toContain('THREE')
  })

  it('只改 styles.css 也必须拿到新样式', async () => {
    theme('style-cache', OK)
    writeFileSync(join(root, 'style-cache', 'styles.css'), '.a{}', 'utf8')
    const transpiler = createThemeTranspiler()
    const first = await transpiler.css(discoverThemes(root)[0]!)
    expect(first).toBe('.a{}')
    writeFileSync(join(root, 'style-cache', 'styles.css'), '.b{color:red}', 'utf8')
    const future = new Date(Date.now() + 2000)
    utimesSync(join(root, 'style-cache', 'styles.css'), future, future)
    expect(await transpiler.css(discoverThemes(root)[0]!)).toBe('.b{color:red}')
  })
})

interface FsCounts {
  readdir: number
  stat: number
  readFile: number
}

/**
 * 一份**独立**的转译器实例，它看到的 `node:fs` 被计数包裹（`vi.doMock` + `vi.resetModules`
 * 只作用在这一个用例里，不污染同文件其它用例 —— 顶层的静态 import 走的还是真模块）。
 *
 * 为什么数 fs 调用而不是量时间：`js()` / `css()` **命中缓存**的那条路径上，唯一会碰文件系统
 * 的就是 stamp，所以「读了几个目录、stat 了几个文件」是 stamp 走了多少路的**确定性**证据；
 * 时间断言在负载机器上会抖。
 */
async function countingTranspiler(options?: {
  /** 让 realpathSync 对某些路径假装「取不到」—— 竞态分支只能这样确定性地触发。 */
  readonly failRealpath?: (path: string) => boolean
}): Promise<{ transpiler: ThemeTranspiler; counts: FsCounts }> {
  const counts: FsCounts = { readdir: 0, stat: 0, readFile: 0 }
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>()
    return {
      ...actual,
      readdirSync: (...args: unknown[]) => {
        counts.readdir += 1
        return (actual.readdirSync as (...a: unknown[]) => unknown)(...args)
      },
      statSync: (...args: unknown[]) => {
        counts.stat += 1
        return (actual.statSync as (...a: unknown[]) => unknown)(...args)
      },
      readFileSync: (...args: unknown[]) => {
        counts.readFile += 1
        return (actual.readFileSync as (...a: unknown[]) => unknown)(...args)
      },
      realpathSync: (...args: unknown[]) => {
        if (options?.failRealpath?.(String(args[0])) === true) {
          throw new Error('ENOENT: 模拟「解析之后、realpath 之前文件消失」')
        }
        return (actual.realpathSync as (...a: unknown[]) => unknown)(...args)
      },
    }
  })
  vi.resetModules()
  const fresh = await import('../packages/plugin-usage-billing/src/themes/transpile.ts')
  return { transpiler: fresh.createThemeTranspiler(), counts }
}

/** 入口 + 一个真正被 import 的依赖文件（主题自己的文件只有这两个）。 */
function twoFileTheme(id: string): void {
  mkdirSync(join(root, id), { recursive: true })
  writeFileSync(join(root, id, 'dep.ts'), `export const V = 'ONE'\n`, 'utf8')
  writeFileSync(
    join(root, id, 'index.tsx'),
    `import { V } from './dep.ts'
export const theme = { label: V, component: () => V }
`,
    'utf8',
  )
}

/** 在主题目录里造一棵 vendored `node_modules`，返回它的文件总数。 */
function vendoredTree(id: string, packages: number, filesPerPackage: number): number {
  for (let p = 0; p < packages; p += 1) {
    const dir = join(root, id, 'node_modules', `pkg-${String(p)}`)
    mkdirSync(dir, { recursive: true })
    for (let f = 0; f < filesPerPackage; f += 1) {
      writeFileSync(join(dir, `f${String(f)}.js`), 'module.exports = 1\n', 'utf8')
    }
  }
  return packages * filesPerPackage
}

describe('stamp 的范围与上限', () => {
  it('vendored node_modules 不进 stamp：命中缓存的成本不随 vendored 文件数增长', async () => {
    twoFileTheme('cost-small')
    twoFileTheme('cost-big')
    const smallTree = vendoredTree('cost-small', 1, 30)
    const bigTree = vendoredTree('cost-big', 10, 30)
    expect(bigTree).toBeGreaterThan(smallTree)

    const { transpiler, counts } = await countingTranspiler()
    // 第一次真转译（填缓存），第二次必定命中缓存 —— 那次只有 stamp 碰 fs。
    const hitCost = async (id: string): Promise<FsCounts> => {
      const source = discoverThemes(root).find((candidate) => candidate.id === id)!
      await transpiler.js(source)
      const before = { ...counts }
      await transpiler.js(source)
      return {
        readdir: counts.readdir - before.readdir,
        stat: counts.stat - before.stat,
        readFile: counts.readFile - before.readFile,
      }
    }

    const small = await hitCost('cost-small')
    const big = await hitCost('cost-big')
    // 两个主题自己的文件数一样、只差 vendored 树的规模：stamp 成本必须逐项相同。
    // 修复前 big 是 12 次 readdir + 302 次 stat（线性于 vendored 文件数）。
    expect(big).toEqual(small)
    expect(big.readdir).toBe(1)
    expect(big.stat).toBeLessThanOrEqual(4)
    expect(big.readFile).toBe(0)
  })

  it('剪掉 node_modules 之后，改动普通依赖文件仍然让缓存失效', async () => {
    twoFileTheme('cost-dep')
    vendoredTree('cost-dep', 4, 20)
    const source = discoverThemes(root)[0]!
    const transpiler = createThemeTranspiler()
    expect(await transpiler.js(source)).toContain('ONE')

    writeFileSync(join(root, 'cost-dep', 'dep.ts'), `export const V = 'TWO'\n`, 'utf8')
    const future = new Date(Date.now() + 2000)
    utimesSync(join(root, 'cost-dep', 'dep.ts'), future, future)
    expect(await transpiler.js(source)).toContain('TWO')
  })

  it(
    'stamp 超上限后按目录 mtime 兜底：加文件仍然失效，且成本被限住',
    async () => {
      theme('capped', OK)
      writeFileSync(join(root, 'capped', 'styles.css'), '.a{}', 'utf8')
      const bulk = join(root, 'capped', 'bulk')
      mkdirSync(bulk, { recursive: true })
      const bulkFiles = 1100
      for (let f = 0; f < bulkFiles; f += 1) writeFileSync(join(bulk, `f${String(f)}.js`), 'x\n', 'utf8')

      const { transpiler, counts } = await countingTranspiler()
      const source = discoverThemes(root)[0]!
      expect(await transpiler.css(source)).toBe('.a{}') // 第一次：读盘 + 填缓存

      const hit = { ...counts }
      await transpiler.css(source) // 命中：不读盘
      expect(counts.readFile - hit.readFile).toBe(0)
      // stamp 被上限限住 —— 修复前这里是 ~1100 次 stat（bulkFiles 个文件全走一遍）。
      expect(counts.stat - hit.stat).toBeLessThan(700)
      expect(bulkFiles).toBeGreaterThan(counts.stat - hit.stat)

      // 往超限子树里加一个与产物无关的文件，并把该目录 mtime 推后：
      // 目录 mtime 进了键，缓存就必须失效（重读 styles.css 是唯一可观察的后果）。
      writeFileSync(join(bulk, 'added.js'), 'x\n', 'utf8')
      const future = new Date(Date.now() + 2000)
      utimesSync(bulk, future, future)
      await transpiler.css(source)
      expect(counts.readFile - hit.readFile).toBeGreaterThan(0)
    },
    60_000,
  )
})

afterEach(() => {
  vi.doUnmock('node:fs')
  vi.resetModules()
})

describe('相对 import 的解析', () => {
  it('缺扩展名的相对 import（./geometry）正常打进产物', async () => {
    mkdirSync(join(root, 'extless'), { recursive: true })
    writeFileSync(join(root, 'extless', 'geometry.ts'), 'export const K = 42\n', 'utf8')
    writeFileSync(
      join(root, 'extless', 'index.tsx'),
      `import { K } from './geometry'
export const theme = { label: 'x', component: () => K }
`,
      'utf8',
    )
    const js = await createThemeTranspiler().js(discoverThemes(root)[0]!)
    expect(js).toContain('42')
  })

  it('目录相对 import（./sub → sub/index.tsx）正常打进产物', async () => {
    mkdirSync(join(root, 'dir-import', 'sub'), { recursive: true })
    writeFileSync(join(root, 'dir-import', 'sub', 'index.tsx'), `export const S = 'SUB'\n`, 'utf8')
    writeFileSync(
      join(root, 'dir-import', 'index.tsx'),
      `import { S } from './sub'
export const theme = { label: S, component: () => S }
`,
      'utf8',
    )
    const js = await createThemeTranspiler().js(discoverThemes(root)[0]!)
    expect(js).toContain('SUB')
  })

  it('import 主题目录本身（"."）报的是「目录本身」，不是「目录之外」', async () => {
    theme('self-import', `import self from '.'
export const theme = { label: 'x', component: () => self }
`)
    await expect(createThemeTranspiler().js(discoverThemes(root)[0]!)).rejects.toThrow(/目录本身/)
  })

  it('解析通过但 realpath 取不到（文件在两步之间消失）：报「读不到」而不是「目录之外」', async () => {
    mkdirSync(join(root, 'race'), { recursive: true })
    writeFileSync(join(root, 'race', 'dep.ts'), `export const V = 'ONE'\n`, 'utf8')
    writeFileSync(
      join(root, 'race', 'index.tsx'),
      `import { V } from './dep'
export const theme = { label: V, component: () => V }
`,
      'utf8',
    )
    // 竞态没法在真 fs 上稳定复现：让 realpathSync 只对解析出来的那个文件「假装取不到」。
    const { transpiler } = await countingTranspiler({ failRealpath: (path) => path.endsWith('dep.ts') })
    await expect(transpiler.js(discoverThemes(root)[0]!)).rejects.toThrow(/读不到/)
  })

  it('主题目录内 node_modules 的相对 import 被拒（不许内联第二份 React）', async () => {
    mkdirSync(join(root, 'vendored', 'node_modules', 'react'), { recursive: true })
    writeFileSync(
      join(root, 'vendored', 'node_modules', 'react', 'index.js'),
      'module.exports = { useState: function () { return 0 } }\n',
      'utf8',
    )
    writeFileSync(
      join(root, 'vendored', 'index.tsx'),
      `import { useState } from './node_modules/react/index.js'
export const theme = { label: 'x', component: () => useState() }
`,
      'utf8',
    )
    await expect(createThemeTranspiler().js(discoverThemes(root)[0]!)).rejects.toThrow(/node_modules/)
  })
})

interface GuardCase {
  readonly name: string
  /** 期望的失败原因（读得懂、且点到违规的那个 specifier）。 */
  readonly reason: RegExp
  /** 主题入口源码；参数是主题目录外的那个绝对路径（按 `/` 归一）。 */
  readonly source: (outsideFile: string) => string
  /** 额外 fixture；返回 false 表示本机不支持这个 case（跳过）。 */
  readonly prepare?: (dir: string, outsideDir: string) => boolean
}

const GUARD_CASES: readonly GuardCase[] = [
  {
    name: 'node: 内建模块',
    reason: /node:fs/,
    source: () => `import { readFileSync } from 'node:fs'
export const theme = { label: 'x', component: () => readFileSync }
`,
  },
  {
    name: '绝对路径',
    reason: /只能 import|目录之外/,
    source: (outsideFile) => `import { x } from '${outsideFile}'
export const theme = { label: 'x', component: () => x }
`,
  },
  {
    name: 'data: 说明符',
    reason: /data:text/,
    source: () => `import x from 'data:text/javascript,export default 1'
export const theme = { label: 'x', component: () => x }
`,
  },
  {
    name: '缺失的相对文件',
    reason: /nope|Cannot read file/,
    source: () => `import { x } from './nope.ts'
export const theme = { label: 'x', component: () => x }
`,
  },
  {
    name: '嵌套模块越界（card.tsx → ../outside/outside.ts）',
    reason: /目录之外/,
    source: () => `import { card } from './card.tsx'
export const theme = { label: 'x', component: () => card() }
`,
  },
  {
    name: 'junction/symlink 把目录外的文件带进来',
    reason: /目录之外/,
    source: () => `import { LEAK } from './vendor/leak.ts'
export const theme = { label: 'x', component: () => LEAK }
`,
    // NTFS junction 不需要管理员权限。建不出来（例如非 Windows/权限不足）就跳过。
    prepare: (dir, outsideDir) => {
      try {
        symlinkSync(outsideDir, join(dir, 'vendor'), 'junction')
        return true
      } catch {
        return false
      }
    },
  },
  {
    name: '文件 symlink 指向主题目录外',
    reason: /目录之外/,
    source: () => `import { LEAK } from './link.ts'
export const theme = { label: 'x', component: () => LEAK }
`,
    prepare: (dir, outsideDir) => {
      try {
        symlinkSync(join(outsideDir, 'leak.ts'), join(dir, 'link.ts'), 'file')
        return true
      } catch {
        return false
      }
    },
  },
  {
    name: 'symlink 子目录指向主题目录外',
    reason: /目录之外/,
    source: () => `import { LEAK } from './linked/leak.ts'
export const theme = { label: 'x', component: () => LEAK }
`,
    prepare: (dir, outsideDir) => {
      try {
        symlinkSync(outsideDir, join(dir, 'linked'), 'dir')
        return true
      } catch {
        try {
          symlinkSync(outsideDir, join(dir, 'linked'), 'junction')
          return true
        } catch {
          return false
        }
      }
    },
  },
  {
    name: 'symlink 链 a -> b -> 主题目录外',
    reason: /目录之外/,
    source: () => `import { LEAK } from './a.ts'
export const theme = { label: 'x', component: () => LEAK }
`,
    prepare: (dir, outsideDir) => {
      try {
        symlinkSync(join(outsideDir, 'leak.ts'), join(dir, 'b.ts'), 'file')
        symlinkSync(join(dir, 'b.ts'), join(dir, 'a.ts'), 'file')
        return true
      } catch {
        return false
      }
    },
  },
  {
    name: 'junction 指到主题自己的 node_modules（拼写里没有 node_modules 段）',
    reason: /node_modules/,
    source: () => `import { useState } from './vendor/react/index.js'
export const theme = { label: 'x', component: () => useState() }
`,
    // 只看拼写的话这条会**通过**：第二份 React 被内联进产物，hooks 静默失效。
    // 判定必须落在解析后的真实路径上。
    prepare: (dir) => {
      const react = join(dir, 'node_modules', 'react')
      mkdirSync(react, { recursive: true })
      writeFileSync(join(react, 'index.js'), 'module.exports = { useState: function () { return 0 } }\n', 'utf8')
      try {
        symlinkSync(join(dir, 'node_modules'), join(dir, 'vendor'), 'junction')
        return true
      } catch {
        return false
      }
    },
  },
]

describe('guard 负例表', () => {
  it.each(GUARD_CASES)('$name', async (testCase, context) => {
    const outsideDir = join(root, 'outside')
    mkdirSync(outsideDir, { recursive: true })
    const outsideFile = join(outsideDir, 'outside.ts')
    writeFileSync(outsideFile, `export const x = 1\nexport const LEAK = 'LEAKED'\n`, 'utf8')
    writeFileSync(join(outsideDir, 'leak.ts'), `export const LEAK = 'LEAKED'\n`, 'utf8')
    const dir = join(root, 'victim')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'card.tsx'),
      `import { x } from '../outside/outside.ts'
export const card = () => x
`,
      'utf8',
    )
    if (testCase.prepare !== undefined && !testCase.prepare(dir, outsideDir)) {
      // 本机建不出 symlink / junction（平台或权限）：显式跳过，不伪装成通过。
      context.skip()
      return
    }
    writeFileSync(join(dir, 'index.tsx'), testCase.source(outsideFile.replaceAll('\\', '/')), 'utf8')
    const found = discoverThemes(root).find((candidate) => candidate.id === 'victim')
    expect(found).toBeDefined()

    const outcome = await createThemeTranspiler()
      .js(found!)
      .then(
        (js) => (js.includes('LEAKED') ? '转译成功了，产物里**内联了主题目录外的内容**' : '转译成功了'),
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      )
    expect(outcome).toMatch(testCase.reason)
  })
})

describe('guard 正例对照', () => {
  it('主题目录里真实存在的普通文件照常打进产物（负例不是靠「一律拒绝」通过的）', async () => {
    mkdirSync(join(root, 'benign'), { recursive: true })
    writeFileSync(join(root, 'benign', 'own.ts'), `export const OWN = 'OWN-VALUE'\n`, 'utf8')
    writeFileSync(
      join(root, 'benign', 'index.tsx'),
      `import { OWN } from './own.ts'
export const theme = { label: OWN, component: () => OWN }
`,
      'utf8',
    )
    const js = await createThemeTranspiler().js(discoverThemes(root)[0]!)
    expect(js).toContain('OWN-VALUE')
  })
})

describe('坏主题的隔离', () => {
  it('并排的坏主题只让自己失败，好主题照常进 themes', async () => {
    theme('a-good', OK)
    theme('b-bad', `import x from 'lodash'
export const theme = { label: 'x', component: () => x }
`)
    const transpiler = createThemeTranspiler()
    const found = discoverThemes(root)
    expect(found.map((t) => t.id)).toEqual(['a-good', 'b-bad'])
    const good = await transpiler.js(found[0]!)
    expect(good).toContain('__usageBillingThemeHost.define("a-good"')
    await expect(transpiler.js(found[1]!)).rejects.toThrow(/lodash/)
  })
})
