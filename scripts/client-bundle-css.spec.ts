/**
 * 客户端样式表的两条编译路径（契约），以及 module.css 外来类名的门禁。
 *
 * 契约（实现在 scripts/tsdown.client.mjs 的 dsh-css-inline 插件）：
 * - *.module.css  → 类名编译成 [hash]_[local]；:global(...) 里的原样保留；
 * - *.css         → 整段不哈希，侧效应注入 <style>；
 * - *.css?inline  → 只出文本，运行时不注入。
 *
 * 门禁起因：.ProseMirror 这类库类名漏包 :global() 会被一起哈希，可 DOM 上只有裸类名，
 * 选择器永不匹配 —— CSS 不报错、devtools 也不显示不匹配的规则，整段排版静默失效。
 * 判定：非 :global() 的类名必须能在包内 .ts/.tsx 里以 styles.xxx 取到；编译期取不到的
 * 动态类名（styles['importanceLv' + n]）在该 module.css 顶部声明
 * 「dynamic-classes: 名称或前缀*」放行。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clientBundle } from './tsdown.client.mjs'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

interface CssPlugin {
  name: string
  resolveId?: (source: string, importer?: string) => string | null
  load?: (this: { addWatchFile(id: string): void }, id: string) => string | null
}

function cssPlugin(): CssPlugin {
  const config = clientBundle('@zzerx/dsh-plugin-notes') as { plugins: CssPlugin[] }
  const plugin = config.plugins.find(candidate => candidate.name === 'dsh-css-inline')
  if (plugin === undefined) throw new Error('client bundle 里没有 dsh-css-inline 插件')
  return plugin
}

/** 注入模块把样式正文写成 const css = "<json>"。 */
function injectedCss(output: string): string {
  const match = output.match(/const css = ("(?:[^"\\]|\\.)*");/)
  if (match === null) throw new Error('注入模块里没有 const css = "..."')
  return JSON.parse(match[1] as string) as string
}

/** module.css 产物末尾的类名映射：export default {"本地名":"哈希名"}。 */
function classMap(output: string): Record<string, string> {
  const match = output.match(/export default (\{.*\});/)
  if (match === null) throw new Error('module.css 产物里没有类名映射')
  return JSON.parse(match[1] as string) as Record<string, string>
}

async function withFixture<T>(
  prefix: string,
  file: string,
  content: string,
  run: (output: string) => T,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  try {
    const stylesheet = join(root, file)
    await writeFile(stylesheet, content)
    const plugin = cssPlugin()
    const virtualId = plugin.resolveId?.(`./${file}`, join(root, 'index.ts'))
    if (typeof virtualId !== 'string' || plugin.load === undefined) throw new Error('css 插件钩子不完整')
    const watched: string[] = []
    const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)
    expect(watched).toEqual([stylesheet])
    return run(output)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('client bundle CSS Modules', () => {
  it('自己的类名被哈希，:global() 里的库类名原样保留', async () => {
    await withFixture(
      'dsh-css-module-',
      'Fixture.module.css',
      '.root { color: red; }\n.editor :global(.ProseMirror) { outline: none; }\n',
      output => {
        expect(output).toContain('data-plugin-css')
        const css = injectedCss(output)
        expect(css).toMatch(/\.\w+_root\{color:red\}/)
        expect(css).toContain('.ProseMirror{outline:none}')
        expect(classMap(output).root).toMatch(/_root$/)
        expect(classMap(output).ProseMirror).toBeUndefined()
      },
    )
  })

  it('普通 .css 整段不哈希，只做侧效应注入', async () => {
    await withFixture('dsh-css-global-', 'base.css', '.foo { color: red; }\n', output => {
      expect(output).toContain('data-plugin-css')
      expect(injectedCss(output)).toContain('.foo{color:red}')
      expect(output).toContain('export default "";')
    })
  })

  it('.css?inline 只出文本，运行时不注入', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-css-inline-'))
    try {
      const stylesheet = join(root, 'base.css')
      await writeFile(stylesheet, '.foo { color: red; }\n')
      const plugin = cssPlugin()
      const virtualId = plugin.resolveId?.('./base.css?inline', join(root, 'index.ts'))
      if (typeof virtualId !== 'string' || plugin.load === undefined) throw new Error('css 插件钩子不完整')
      const output = await plugin.load.call({ addWatchFile: () => undefined }, virtualId)
      expect(output).toContain('export default ".foo{color:red}"')
      expect(output).not.toContain('data-plugin-css')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

/* ---------- module.css 外来类名门禁 ---------- */

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else out.push(path)
  }
  return out
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** 去注释：注释里的类名不算引用（排查时留下的 .ProseMirror 字样坑过一次）。 */
function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** 去掉 :global(...) 段（括号可嵌套）。 */
function stripGlobal(css: string): string {
  let out = ''
  let index = 0
  while (index < css.length) {
    const start = css.indexOf(':global(', index)
    if (start === -1) {
      out += css.slice(index)
      break
    }
    out += css.slice(index, start)
    let depth = 1
    let cursor = start + ':global('.length
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '(') depth++
      else if (css[cursor] === ')') depth--
      cursor++
    }
    index = cursor
  }
  return out
}

function collectClassNames(selector: string, into: Set<string>): void {
  for (const match of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    if (match[1] !== undefined) into.add(match[1])
  }
}

/** 选择器位置的类名：注释外、声明块外、:global() 外（@media 里也算，照收）。 */
function foreignClassNames(css: string): string[] {
  const text = stripGlobal(stripCssComments(css))
  const names = new Set<string>()
  // 栈顶 true = 里面的内容还是规则（选择器有效）；false = 声明块，整段跳过。
  const contexts: boolean[] = []
  let prelude = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (contexts[contexts.length - 1] === false) {
      if (char === '}') {
        contexts.pop()
        prelude = ''
      }
      continue
    }
    if (char === '{') {
      const head = prelude.trim()
      collectClassNames(head, names)
      // at-rule（@media/@keyframes…）里还是规则；普通规则的块里是声明。
      contexts.push(head.startsWith('@'))
      prelude = ''
    } else if (char === '}') {
      contexts.pop()
      prelude = ''
    } else {
      prelude += char
    }
  }
  return [...names]
}

/** 文件顶部声明的动态类名模式（编译期静态匹配不到的那些）。 */
function dynamicPatterns(css: string): string[] {
  const patterns: string[] = []
  for (const comment of css.match(/\/\*[\s\S]*?\*\//g) ?? []) {
    const match = comment.match(/dynamic-classes\s*:\s*([^\n]*)/)
    if (match === null) continue
    const declared = (match[1] as string).split('*/')[0] as string
    patterns.push(...declared.trim().split(/\s+/).filter(Boolean))
  }
  return patterns
}

function matchesPattern(name: string, patterns: string[]): boolean {
  return patterns.some(pattern =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  )
}

/** 导入了这个 module.css 的默认绑定名（import styles from './x.module.css'）。 */
function cssBindings(stylesheet: string, sources: { file: string; text: string }[]): string[] {
  const bindings = new Set<string>()
  for (const { file, text } of sources) {
    for (const match of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g)) {
      const [, binding, specifier] = match
      if (binding === undefined || specifier === undefined) continue
      if (!specifier.endsWith('.module.css')) continue
      if (resolve(dirname(file), specifier) === stylesheet) bindings.add(binding)
    }
  }
  return [...bindings]
}

function referencedFromTs(name: string, bindings: string[], text: string): boolean {
  return bindings.some(binding =>
    new RegExp(`\\b${binding}\\s*\\.\\s*${name}\\b`).test(text)
    || new RegExp(`\\b${binding}\\s*\\[\\s*['"]${name}['"]\\s*\\]`).test(text),
  )
}

function collectViolations(): string[] {
  const violations: string[] = []
  const packagesDir = join(REPO_ROOT, 'packages')
  if (!existsSync(packagesDir)) return violations
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const files = walk(join(packagesDir, entry.name, 'src'))
    const sources = files
      .filter(file => /\.tsx?$/.test(file))
      .map(file => ({ file, text: stripTsComments(readFileSync(file, 'utf8')) }))
    const packageSources = sources.map(source => source.text).join('\n')
    for (const stylesheet of files.filter(file => file.endsWith('.module.css'))) {
      const css = readFileSync(stylesheet, 'utf8')
      const declared = dynamicPatterns(css)
      const bindings = cssBindings(stylesheet, sources)
      const relativePath = stylesheet.slice(REPO_ROOT.length).replace(/\\/g, '/')
      for (const name of foreignClassNames(css)) {
        if (referencedFromTs(name, bindings, packageSources)) continue
        if (matchesPattern(name, declared)) continue
        violations.push(relativePath + ' 的 .' + name)
      }
    }
  }
  return violations
}

describe('module.css 外来类名门禁', () => {
  it('非 :global() 的类名都能被包内 TS 取到，或已声明为动态类名', () => {
    const violations = collectViolations()
    expect(
      violations,
      '以下类名会被哈希但包内取不到 —— 库类名请写成 :global(.xxx)，'
      + '动态类名（styles[key]）请在文件顶部声明 dynamic-classes: 名称或前缀*',
    ).toEqual([])
  })
})
