import { deflateSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  SWEETIE16_INPUTS,
  SWEETIE16_LUT,
  remapImageData,
} from '../packages/plugin-agent-studio/src/client/core/pixel/lut.ts'
import {
  ATLAS_ENTRIES,
  ATLAS_SHEETS,
  ATLAS_SOURCE_SHA256,
} from '../packages/plugin-agent-studio/src/client/core/pixel/atlas-map.generated.ts'
import {
  atlasSizeMatches,
  computeAtlasAvailable,
  findAtlasEntry,
  isPlaceholderImage,
  sheetSize,
} from '../packages/plugin-agent-studio/src/client/core/pixel/atlas.ts'
import {
  decodePng,
  encodePng,
  findComponents,
  packAtlas,
  runBuild,
} from '../packages/plugin-agent-studio/scripts/build-pixel-atlas.mjs'

describe('agent studio pixel lut', () => {
  it('has exactly the 16 Sweetie16 input colors', () => {
    expect(SWEETIE16_LUT).toHaveLength(16)
    expect(SWEETIE16_INPUTS).toEqual([
      [0x1a, 0x1c, 0x2c],
      [0x33, 0x3c, 0x57],
      [0x56, 0x6c, 0x86],
      [0x94, 0xb0, 0xc2],
      [0xf4, 0xf4, 0xf4],
      [0x41, 0xa6, 0xf6],
      [0x29, 0x36, 0x6f],
      [0x3b, 0x5d, 0xc9],
      [0x73, 0xef, 0xf7],
      [0x25, 0x71, 0x79],
      [0x38, 0xb7, 0x64],
      [0xa7, 0xf0, 0x70],
      [0xff, 0xcd, 0x75],
      [0xef, 0x7d, 0x57],
      [0xb1, 0x3e, 0x53],
      [0x5d, 0x27, 0x5d],
    ])
  })

  it('targets only tokens or color-mix over tokens', () => {
    for (const entry of SWEETIE16_LUT) {
      const ok =
        entry.token.startsWith('var(--dsw-alias-') ||
        (entry.token.startsWith('color-mix(in srgb, var(--dsw-alias-') &&
          entry.token.includes('var(--dsw-alias-state-'))
      expect(ok).toBe(true)
    }
  })

  it('remaps the first Sweetie16 source color to its target', () => {
    // [26,28,44] = #1a1c2c；目标表第 0 项给 [0,0,0]，必须命中。
    // 同色的 alpha=0 像素是透明残留，必须逐字节原样保留，与上面区分。
    const data = new Uint8ClampedArray([26, 28, 44, 255, 26, 28, 44, 0])
    const targets: readonly (readonly [number, number, number])[] = [
      [0, 0, 0],
      ...SWEETIE16_INPUTS.slice(1).map(() => [9, 9, 9] as const),
    ]
    remapImageData(data, targets)
    expect([...data.slice(0, 4)]).toEqual([0, 0, 0, 255])
    expect([...data.slice(4, 8)]).toEqual([26, 28, 44, 0])
  })

  it('remaps a mixed image by exact source color and keeps unmatched pixels', () => {
    const data = new Uint8ClampedArray([
      0x1a, 0x1c, 0x2c, 255, // Sweetie16 #1 → 目标 [1,1,1]
      0x12, 0x34, 0x56, 255, // 未命中 → 原样
      0xf4, 0xf4, 0xf4, 255, // Sweetie16 #5 → 目标 [5,5,5]
      0x41, 0xa6, 0xf6, 0, // alpha=0 残留 → 原样
    ])
    const targets: readonly (readonly [number, number, number])[] = SWEETIE16_INPUTS.map((c, i) =>
      i === 0 ? [1, 1, 1] : i === 4 ? [5, 5, 5] : c,
    )
    remapImageData(data, targets)
    expect([...data.slice(0, 4)]).toEqual([1, 1, 1, 255])
    expect([...data.slice(4, 8)]).toEqual([0x12, 0x34, 0x56, 255])
    expect([...data.slice(8, 12)]).toEqual([5, 5, 5, 255])
    expect([...data.slice(12, 16)]).toEqual([0x41, 0xa6, 0xf6, 0])
  })

  it('rejects a lut whose length differs from the Sweetie16 table', () => {
    expect(() => remapImageData(new Uint8ClampedArray(8), [[0, 0, 0]])).toThrow(/lut length/)
  })
})

describe('agent studio atlas map', () => {
  it('records a sha256 and non-empty sheets', () => {
    expect(ATLAS_SOURCE_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(ATLAS_SHEETS.env.width).toBeGreaterThan(0)
    expect(ATLAS_SHEETS.chars.width).toBeGreaterThan(0)
  })

  it('has unique ids and every rect inside its sheet', () => {
    const ids = new Set(ATLAS_ENTRIES.map((e) => e.id))
    expect(ids.size).toBe(ATLAS_ENTRIES.length)
    for (const e of ATLAS_ENTRIES) {
      const size = ATLAS_SHEETS[e.sheet]
      expect(e.w).toBeGreaterThan(0)
      expect(e.h).toBeGreaterThan(0)
      expect(e.x + e.w).toBeLessThanOrEqual(size.width)
      expect(e.y + e.h).toBeLessThanOrEqual(size.height)
    }
  })

  it('has no rect overlap within a sheet', () => {
    for (const sheet of ['env', 'chars'] as const) {
      const list = ATLAS_ENTRIES.filter((e) => e.sheet === sheet)
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]
          const b = list[j]
          const disjoint =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
          expect(disjoint).toBe(true)
        }
      }
    }
  })

  it('keeps 16 char pose entries with bottom-center pivots and env top-left pivots', () => {
    const chars = ATLAS_ENTRIES.filter((e) => e.sheet === 'chars')
    expect(chars.map((e) => e.id)).toEqual([
      'char-1-idle', 'char-1-sit', 'char-1-walk-1', 'char-1-walk-2',
      'char-2-idle', 'char-2-sit', 'char-2-walk-1', 'char-2-walk-2',
      'char-3-idle', 'char-3-sit', 'char-3-walk-1', 'char-3-walk-2',
      'char-4-idle', 'char-4-sit', 'char-4-walk-1', 'char-4-walk-2',
    ])
    for (const e of chars) {
      expect(e.pivotX).toBe(Math.floor(e.w / 2))
      expect(e.pivotY).toBe(e.h)
    }
    const env = ATLAS_ENTRIES.filter((e) => e.sheet === 'env')
    expect(env.map((e) => e.id)).toEqual(['cat-1', 'cat-2', 'corgi-1', 'corgi-2'])
    for (const e of env) {
      expect(e.pivotX).toBe(0)
      expect(e.pivotY).toBe(0)
    }
  })

  it('matches the semantic map file ids one to one', () => {
    const mapPath = new URL(
      '../packages/plugin-agent-studio/scripts/pixel-atlas.map.json',
      import.meta.url,
    )
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, { id: string }>
    expect(new Set(Object.values(map).map((v) => v.id))).toEqual(
      new Set(ATLAS_ENTRIES.map((e) => e.id)),
    )
  })
})

describe('agent studio atlas runtime logic', () => {
  it('flags placeholder size and mismatched sheets', () => {
    expect(isPlaceholderImage(1, 1)).toBe(true)
    expect(isPlaceholderImage(256, 174)).toBe(false)
    expect(atlasSizeMatches('env', ATLAS_SHEETS.env.width, ATLAS_SHEETS.env.height)).toBe(true)
    expect(atlasSizeMatches('env', 1, 1)).toBe(false)
  })

  it('requires both sheets available for degradation-free rendering', () => {
    const real = (['bg', 'chars'] as const).map((sheet) => ({
      sheet,
      width: sheetSize(sheet).width,
      height: sheetSize(sheet).height,
    }))
    expect(computeAtlasAvailable(real)).toBe(true)
    expect(computeAtlasAvailable(real.map((s) => ({ ...s, width: 1, height: 1 })))).toBe(false)
    expect(computeAtlasAvailable([real[0]])).toBe(false)
  })

  it('finds atlas entries by semantic id', () => {
    expect(findAtlasEntry('corgi-1')?.sheet).toBe('env')
    expect(findAtlasEntry('char-3-sit')?.sheet).toBe('chars')
    expect(findAtlasEntry('no-such-id')).toBeUndefined()
  })
})

describe('agent studio atlas script pure functions', () => {
  it('roundtrips rgba through encodePng/decodePng byte-exactly', () => {
    const w = 5
    const h = 3
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) % 256
    const png = encodePng(rgba, w, h)
    const decoded = decodePng(png)
    expect(decoded.width).toBe(w)
    expect(decoded.height).toBe(h)
    expect([...decoded.rgba]).toEqual([...rgba])
  })

  it('decodes a hand-crafted png using filters 1 to 4', () => {
    // 4 行分别用 Sub/Up/Average/Paeth 滤波，手工构造 raw 扫描线再解码比对。
    const w = 4
    const h = 4
    const bpp = 4
    const stride = w * bpp
    const raw = new Uint8ClampedArray(w * h * 4)
    for (let x = 0; x < w; x++) raw.set([10 + x, 200, 30, 255], x * 4)
    for (let x = 0; x < w; x++) raw.set([40, 50 + x, 60, 255], stride + x * 4)
    for (let x = 0; x < w; x++) raw.set([70, 80, 90 + x, 255], 2 * stride + x * 4)
    for (let x = 0; x < w; x++) raw.set([110 + x, 120, 130, 255], 3 * stride + x * 4)
    const filtered = Buffer.alloc((stride + 1) * h)
    for (let y = 0; y < h; y++) {
      filtered[y * (stride + 1)] = y + 1
      for (let x = 0; x < w; x++) {
        const i = y * stride + x * bpp
        for (let k = 0; k < bpp; k++) {
          const cur = raw[i + k]
          const left = x > 0 ? raw[i - bpp + k] : 0
          const up = y > 0 ? raw[i - stride + k] : 0
          const ul = y > 0 && x > 0 ? raw[i - stride - bpp + k] : 0
          let v = cur
          if (y === 0) v -= left
          else if (y === 1) v -= up
          else if (y === 2) v -= (left + up) >> 1
          else {
            const p = left + up - ul
            const pa = Math.abs(p - left)
            const pb = Math.abs(p - up)
            const pc = Math.abs(p - ul)
            v -= pa <= pb && pa <= pc ? left : pb <= pc ? up : ul
          }
          filtered[y * (stride + 1) + 1 + x * bpp + k] = v & 0xff
        }
      }
    }
    const decoded = decodePng(craftPng(filtered, w, h))
    expect(decoded.width).toBe(w)
    expect(decoded.height).toBe(h)
    expect([...decoded.rgba]).toEqual([...raw])
  })

  it('connects diagonals with 8-adjacency and filters by min area', () => {
    // 8-connected L blob (diagonals join) + an isolated 2x1 speck two px away
    const w = 4
    const h = 3
    const rgba = new Uint8ClampedArray(w * h * 4)
    const set = (x: number, y: number) => {
      rgba[(y * w + x) * 4 + 3] = 255
    }
    set(0, 0)
    set(1, 1)
    set(0, 2)
    set(3, 0)
    set(3, 1)
    const all = findComponents(rgba, w, h, { gap: 0, minArea: 1 })
    expect(all).toHaveLength(2)
    expect(all[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 3, area: 3 })
    expect(all[1]).toMatchObject({ x: 3, y: 0, w: 1, h: 2, area: 2 })
    const filtered = findComponents(rgba, w, h, { gap: 0, minArea: 3 })
    expect(filtered).toHaveLength(1)
  })

  it('keeps a component whose area equals the min-area boundary', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4)
    for (let x = 0; x < 3; x++) rgba[x * 4 + 3] = 255
    const comps = findComponents(rgba, 4, 4, { gap: 0, minArea: 3 })
    expect(comps).toHaveLength(1)
    expect(comps[0].area).toBe(3)
  })

  it('merges pixels across a one-pixel gap with gap=1', () => {
    const rgba = new Uint8ClampedArray(5 * 4 * 4)
    for (const x of [0, 2, 4]) rgba[x * 4 + 3] = 255
    expect(findComponents(rgba, 5, 4, { gap: 0, minArea: 1 })).toHaveLength(3)
    expect(findComponents(rgba, 5, 4, { gap: 1, minArea: 1 })).toHaveLength(1)
  })

  it('packs entries per sheet, wraps rows, and never mixes sheets in a row', () => {
    const entry = (id: string, sheet: 'env' | 'chars', w: number, h: number) => ({
      id, sheet, w, h, x0: 0, y0: 0, pivotX: 0, pivotY: 0,
    })
    const packed = packAtlas(
      [entry('a', 'env', 30, 10), entry('b', 'env', 30, 20), entry('wide', 'env', 60, 5), entry('c', 'chars', 10, 5)],
      64,
    )
    expect(packed.sizes.env).toEqual({ width: 60, height: 25 })
    expect(packed.sizes.chars).toEqual({ width: 10, height: 5 })
    expect(packed.placed.find((p) => p.id === 'wide')).toMatchObject({ x: 0, y: 20 })
    expect(packed.placed.find((p) => p.id === 'c')).toMatchObject({ x: 0, y: 0 })
  })

  it('runs build + check end to end on a synthetic fixture', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-spec-'))
    try {
      // 24x14 fixture：env 两块 + chars 一块，色块间留透明隔离。
      const w = 24
      const h = 14
      const rgba = new Uint8ClampedArray(w * h * 4)
      const fill = (x: number, y: number, pw: number, ph: number, r: number, g: number, b: number) => {
        for (let dy = 0; dy < ph; dy++) {
          for (let dx = 0; dx < pw; dx++) {
            const o = ((y + dy) * w + (x + dx)) * 4
            rgba[o] = r
            rgba[o + 1] = g
            rgba[o + 2] = b
            rgba[o + 3] = 255
          }
        }
      }
      fill(1, 1, 4, 3, 26, 28, 44)
      fill(10, 1, 3, 2, 244, 244, 244)
      fill(2, 8, 5, 4, 65, 35, 5)
      const input = join(dir, 'src.png')
      writeFileSync(input, encodePng(rgba, w, h))
      const mapPath = join(dir, 'map.json')
      writeFileSync(
        mapPath,
        JSON.stringify({
          '1,1,4,3': { id: 'blob-a', sheet: 'env' },
          '10,1,3,2': { id: 'blob-b', sheet: 'env' },
          '2,8,5,4': { id: 'char-1', sheet: 'chars', pivot: [2, 4] },
        }),
      )
      const out = join(dir, 'out')
      const tsPath = join(dir, 'atlas-map.generated.ts')
      const argv = ['--input', input, '--map', mapPath, '--out', out, '--ts', tsPath, '--min-area', '1']
      runBuild(argv)
      const ts = readFileSync(tsPath, 'utf8')
      expect(ts).toContain("id: 'blob-a'")
      expect(ts).toContain('ATLAS_SCRIPT_VERSION')
      expect(ts).not.toContain('ATLAS_GENERATED_AT')
      const env = decodePng(readFileSync(join(out, 'pixel-office.env.png')))
      expect(env.width).toBe(7)
      expect(env.height).toBe(3)
      // 重跑幂等：生成 ts 字节不变。
      runBuild(argv)
      expect(readFileSync(tsPath, 'utf8')).toBe(ts)
      // --check 通过（不 exit）。
      runBuild([...argv, '--check'])
      // 故意改 ts 里的一个 pivot，--check 必须抓到漂移并 exit 1。
      writeFileSync(tsPath, ts.replace('pivotX: 2, pivotY: 4', 'pivotX: 0, pivotY: 0'))
      const errors: string[] = []
      const recordedError = console.error
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit ${code}`)
      }) as never)
      console.error = (line: unknown) => errors.push(String(line))
      try {
        expect(() => runBuild([...argv, '--check'])).toThrow('exit 1')
      } finally {
        console.error = recordedError
        exitSpy.mockRestore()
      }
      expect(errors.join('\n')).toContain('drifted')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// 手工拼 PNG chunk（filter fixture 专用；decodePng 只需要 IHDR/IDAT/IEND）。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function craftPng(filtered: Buffer, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
