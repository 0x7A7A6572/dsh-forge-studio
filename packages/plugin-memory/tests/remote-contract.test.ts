/**
 * 远程契约一致性：host 的 SRC 标记方法 ↔ client descriptors。
 *
 * 为什么必须有：Typert SRC 模式下 host 是「手写复刻 @Remote 装饰器」，client 是
 * 「手写 descriptors」，两边靠命名约定对齐，编译器管不到。方法名或形参名写错，
 * 只有真正挂载 / 真正调用那一刻才炸。这里把三件事故提前到测试里：
 * 1. 方法集合两边一致；
 * 2. 形参名与 wire 名逐字一致（含顺序）；
 * 3. 形参是纯标识符 —— 以及「严格 codec 的形参在窄接口里不许写成可选」，
 *    因为 client 侧 arity 校验会在无参调用时直接抛 expected N argument(s)。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const SERVICE = join(here, '..', 'src', 'service.ts')
const REMOTE = join(here, '..', 'src', 'client', 'core', 'remote.ts')

/** host 侧被标记为远程方法的名字（markRemoteMethods 的那个数组）。 */
function markedMethods(source: string): string[] {
  const block = /markRemoteMethods\(MemoryService\.prototype,\s*\[([\s\S]*?)\]\)/.exec(source)
  if (block === null) throw new Error('markRemoteMethods 调用没找到')
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!)
}

/** host 侧某个方法的形参名列表（SRC 模式要求是纯标识符）。 */
function hostParams(source: string, method: string): string[] {
  const pattern = new RegExp('^ {2}(?:async )?' + method + '\\(([^)]*)\\)', 'm')
  const hit = pattern.exec(source)
  if (hit === null) throw new Error('host 方法没找到：' + method)
  const raw = hit[1]!.trim()
  if (raw === '') return []
  // 可选形参（projectPath?: string）在 SRC 里合法，比较时只看名字。
  return raw.split(',').map((part) => part.trim().split(':')[0]!.replace(/[?!]+$/, '').trim())
}

/** 一段 descriptor 参数文本 → wire 名 + codec 名（codec 名用来判断「能不能省略」）。 */
function paramsIn(block: string): Array<{ wire: string; codec: string }> {
  return [...block.matchAll(/name: '([^']+)'[^}]*?codec: ([A-Za-z_$][\w$]*)/g)]
    .map((match) => ({ wire: match[1]!, codec: match[2]! }))
}

/** client 侧复用的参数常量（idParam / rawIdParam / scopeTargetParams）。 */
function paramConstants(source: string): Map<string, Array<{ wire: string; codec: string }>> {
  const out = new Map<string, Array<{ wire: string; codec: string }>>()
  const pattern = /^const (\w+)[^=]*= \[([\s\S]*?)^\]/gm
  for (const match of source.matchAll(pattern)) out.set(match[1]!, paramsIn(match[2]!))
  return out
}

interface ClientContract {
  /** 方法 → wire 名（按声明顺序）。 */
  readonly methods: Map<string, string[]>
  /** 方法 → 每个 wire 用的 codec 名（按声明顺序）。 */
  readonly codecs: Map<string, string[]>
}

/** 解析 client 侧 descriptors：方法名、wire 名、codec 名。 */
function clientContract(source: string): ClientContract {
  const lines = source.split(/\r?\n/)
  const constants = paramConstants(source)
  const methods = new Map<string, string[]>()
  const codecs = new Map<string, string[]>()
  for (let index = 0; index < lines.length; index += 1) {
    const start = /descriptor\('([^']+)'/.exec(lines[index]!)
    if (start === null) continue
    const method = start[1]!
    let depth = 0
    let block = ''
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]!
      block += line + '\n'
      for (const char of line) {
        if (char === '(') depth += 1
        else if (char === ')') depth -= 1
      }
      if (depth <= 0) break
    }
    // 参数可能内联（name: 'x' + codec）也可能复用常量（...idParam / scopeTargetParams），
    // 按出现顺序展开，constant 与内联混用时顺序也保持一致。
    const inline = new Map(paramsIn(block).map((item) => [item.wire, item.codec] as const))
    const wires: string[] = []
    const used: string[] = []
    for (const token of block.matchAll(/name: '([^']+)'|([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
      if (token[1] !== undefined) {
        wires.push(token[1]!)
        used.push(inline.get(token[1]!) ?? '?')
        continue
      }
      const shared = constants.get(token[2]!)
      if (shared === undefined) continue
      for (const item of shared) { wires.push(item.wire); used.push(item.codec) }
    }
    methods.set(method, wires)
    codecs.set(method, used)
  }
  return { methods, codecs }
}

/** 窄接口里某个方法的形参文本（'query: MemoryQuery' / 'scope: MemoryScope, projectPath?: string'）。 */
function narrowParams(source: string, method: string): string[] | undefined {
  const start = source.indexOf('export interface MemoryRemote {')
  if (start < 0) return undefined
  const hit = new RegExp('^ {2}' + method + '\\(([^)]*)\\)', 'm').exec(source.slice(start))
  if (hit === null) return undefined
  return hit[1]!.split(',').map((part) => part.trim()).filter((part) => part !== '')
}

const serviceSource = readFileSync(SERVICE, 'utf8')
const remoteSource = readFileSync(REMOTE, 'utf8')
const contract = clientContract(remoteSource)

describe('远程契约', () => {
  it('client descriptors 与 host 的远程方法集合完全一致', () => {
    const host = markedMethods(serviceSource).slice().sort()
    const client = [...contract.methods.keys()].slice().sort()
    expect(client).toEqual(host)
  })

  it('每个远程方法的形参名与 wire 名逐字一致', () => {
    for (const method of markedMethods(serviceSource)) {
      expect(contract.methods.get(method), method + ' 缺少 descriptor')
        .toEqual(hostParams(serviceSource, method))
    }
  })

  it('形参是纯标识符（SRC 不允许默认值 / 解构 / rest）', () => {
    for (const method of markedMethods(serviceSource)) {
      for (const param of hostParams(serviceSource, method)) {
        expect(param, method + ' 的形参 ' + param).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
      }
    }
  })

  it('严格 codec 的形参在窄接口里不许写成可选（否则无参调用会在运行时抛错）', () => {
    for (const [method, wires] of contract.methods) {
      const declared = narrowParams(remoteSource, method)
      if (declared === undefined) continue
      expect(declared.length, method + ' 的窄接口形参个数与 descriptor 不一致').toBe(wires.length)
      const codecs = contract.codecs.get(method) ?? []
      wires.forEach((wire, index) => {
        const param = declared[index]!
        // 只有 optional* codec（如 optionalString）才允许省略成 projectPath?。
        const omissible = (codecs[index] ?? '?').startsWith('optional')
        expect(param.includes('?:'), method + ' 的 ' + wire).toBe(omissible)
      })
    }
  })
})
