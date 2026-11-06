/**
 * 离线切图：PixelOfficeAssets.png → env/chars 两张 atlas + 坐标表。
 * 零第三方依赖：自带 PNG 解码（zlib inflate + 去滤波）与编码（deflate + CRC）。
 */
import { createHash } from 'node:crypto'
import { deflateSync, inflateSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCRIPT_VERSION = '1.1.0'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SHEETS = ['env', 'chars']
const DEFAULT_ASSET_RELPATH = '.agents/tmp/pixel-assets/worker/人物-动物.png'
const DEFAULT_ASE_RELPATH = '.agents/tmp/pixel-assets/3ba55dfd8f5d7495/PixelOffice/PixelOffice.aseprite'
const DEFAULT_REF_RELPATH = '.agents/tmp/pixel-assets/3ba55dfd8f5d7495/PixelOffice/PixelOffice.png'

// --compose-bg：从参考场景擦除的角色 bbox（ref 坐标；接待位拆头部/桌下两段）。
const BG_CHAR_RECTS = [
  { id: 'reception-head', x: 68, y: 100, w: 20, h: 6 },
  { id: 'reception-legs', x: 68, y: 121, w: 20, h: 4 },
  { id: 'sofa-1', x: 107, y: 104, w: 21, h: 25 },
  { id: 'sofa-2', x: 128, y: 104, w: 21, h: 25 },
  { id: 'char-2', x: 220, y: 133, w: 21, h: 27 },
  { id: 'char-4b', x: 106, y: 167, w: 21, h: 27 },
  { id: 'char-5b', x: 128, y: 167, w: 21, h: 27 },
  { id: 'sitting', x: 41, y: 167, w: 16, h: 27 },
]

// --compose-bg：座位口径（真源；scene-office-slots.generated.ts 由它派生）。
// 新布局（bg-source 整图，家具整体较旧版下移 20px）：办公区 2 大块 x2 排 x2 座；
// 椅子常拉出（静态烘焙进 bg），工作态 = 坐姿人物帧贴到椅面锚点上（无工位区域资产）。
const BG_SEATS = {
  A1: { order: 1, x: 34, y: 112, station: [23, 93, 39, 30] },
  A2: { order: 2, x: 94, y: 112, station: [63, 93, 39, 30] },
  B1: { order: 3, x: 34, y: 141, station: [23, 123, 39, 30] },
  B2: { order: 4, x: 94, y: 141, station: [63, 123, 39, 30] },
  C1: { order: 5, x: 168, y: 112, station: [157, 93, 39, 30] },
  C2: { order: 6, x: 228, y: 112, station: [197, 93, 39, 30] },
  D1: { order: 7, x: 168, y: 141, station: [157, 123, 39, 30] },
  D2: { order: 8, x: 228, y: 141, station: [197, 123, 39, 30] },
}
// lead = leader 区蓝色扶手椅的坐姿位。
const BG_LEAD = { order: 0, x: 174, y: 83, station: [157, 63, 43, 30] }
// 溢出 = 底部橙色沙发（坐姿帧）。
const BG_OVERFLOW = { order: 100, x: 46, y: 171, station: [35, 160, 33, 16], step: 15, capacity: 2 }

// 空态 = 收椅（统一 C2/模板 B 模块）：块带原点 = 左座 (station.x, station.y-2)、
// 右座 (station.x-39, station.y-2)；compose 的空态贴图与 --check 的豁免区域共用。
function seatBlockRect(seatId, seat) {
  const leftSeat = seatId.endsWith('1')
  return {
    x: leftSeat ? seat.station[0] : seat.station[0] - 39,
    y: seat.station[1] - 2,
    w: 79, h: 30,
  }
}

// CRC32 查表：PNG chunk 校验用，启动时建一次。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** 解码 8-bit PNG（colorType 2/6、非隔行）为 RGBA 像素。 */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG file')
  let width = 0
  let height = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  let offset = 8
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
      if (colorType !== 6 && colorType !== 2) throw new Error(`unsupported color type ${colorType}`)
      if (interlace !== 0) throw new Error('interlaced PNG is not supported')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + len
  }
  if (width <= 0 || height <= 0) throw new Error('missing IHDR')
  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  return unfilter(raw, width, height, channels)
}

function unfilter(raw, width, height, channels) {
  const stride = width * channels
  const bpp = channels
  if (raw.length < (stride + 1) * height) throw new Error('truncated pixel data')
  const rgba = new Uint8ClampedArray(width * height * 4)
  let pos = 0
  const prev = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    for (let i = 0; i < stride; i++) line[i] = raw[pos + i]
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter > 4) {
        throw new Error(`bad filter type ${filter}`)
      }
      line[i] = v & 0xff
    }
    pos += stride
    const o = y * width * 4
    if (channels === 4) {
      for (let x = 0; x < width; x++) {
        rgba[o + x * 4] = line[x * 4]
        rgba[o + x * 4 + 1] = line[x * 4 + 1]
        rgba[o + x * 4 + 2] = line[x * 4 + 2]
        rgba[o + x * 4 + 3] = line[x * 4 + 3]
      }
    } else {
      for (let x = 0; x < width; x++) {
        rgba[o + x * 4] = line[x * 3]
        rgba[o + x * 4 + 1] = line[x * 3 + 1]
        rgba[o + x * 4 + 2] = line[x * 3 + 2]
        rgba[o + x * 4 + 3] = 0xff
      }
    }
    prev.set(line)
  }
  return { width, height, rgba }
}

/** 把 RGBA 像素编码成 PNG（filter 0 + deflate level 9，确定性输出）。 */
export function encodePng(rgba, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 8 邻接连通块（alpha > 0）。gap>0 时把切比雪夫距离 ≤ gap+1 的像素视为连通。
 * 返回按扫描序排列的 bbox 与像素数。
 */
export function findComponents(rgba, width, height, { gap = 0, minArea = 1 } = {}) {
  const radius = gap + 1
  const offsets = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx !== 0 || dy !== 0) offsets.push([dx, dy])
    }
  }
  const visited = new Uint8Array(width * height)
  const comps = []
  const stack = []
  for (let start = 0; start < width * height; start++) {
    if (visited[start] || rgba[start * 4 + 3] === 0) continue
    stack.length = 0
    stack.push(start)
    visited[start] = 1
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    let area = 0
    while (stack.length > 0) {
      const cur = stack.pop()
      const cx = cur % width
      const cy = (cur - cx) / width
      area++
      if (cx < minX) minX = cx
      if (cy < minY) minY = cy
      if (cx > maxX) maxX = cx
      if (cy > maxY) maxY = cy
      for (const [dx, dy] of offsets) {
        const nx = cx + dx
        const ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        if (visited[ni] || rgba[ni * 4 + 3] === 0) continue
        visited[ni] = 1
        stack.push(ni)
      }
    }
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    if (area < minArea) continue
    comps.push({ index: comps.length, x: minX, y: minY, w, h, area })
  }
  return comps
}

/** 行式打包：每个 sheet 独立画布，行内从左到右排，超 maxWidth 换行。 */
export function packAtlas(entries, maxWidth = 256) {
  const placed = []
  const sizes = {}
  const cursors = new Map()
  for (const entry of entries) {
    if (entry.w > maxWidth) throw new Error(`entry ${entry.id} wider than ${maxWidth}`)
    let cur = cursors.get(entry.sheet)
    if (!cur) {
      cur = { y: 0, rowWidth: 0, rowHeight: 0 }
      cursors.set(entry.sheet, cur)
    }
    if (cur.rowWidth + entry.w > maxWidth) {
      cur.y += cur.rowHeight
      cur.rowWidth = 0
      cur.rowHeight = 0
    }
    placed.push({ ...entry, x: cur.rowWidth, y: cur.y })
    cur.rowWidth += entry.w
    cur.rowHeight = Math.max(cur.rowHeight, entry.h)
    const size = sizes[entry.sheet] || { width: 0, height: 0 }
    size.width = Math.max(size.width, cur.rowWidth)
    size.height = Math.max(size.height, cur.y + cur.rowHeight)
    sizes[entry.sheet] = size
  }
  return { placed, sizes }
}

function renderAtlas(size, placed, sheet, sourceRgba, sourceWidth) {
  const out = new Uint8ClampedArray(size.width * size.height * 4)
  for (const it of placed) {
    if (it.sheet !== sheet) continue
    for (let dy = 0; dy < it.h; dy++) {
      const src = ((it.y0 + dy) * sourceWidth + it.x0) * 4
      const dst = ((it.y + dy) * size.width + it.x) * 4
      for (let i = 0; i < it.w * 4; i++) out[dst + i] = sourceRgba[src + i]
    }
  }
  return out
}

function parseArgs(argv) {
  const args = { input: null, out: null, ts: null, map: null, ase: null, ref: null,
    gap: 0, minArea: 15, maxWidth: 256, check: false, composeBg: false, all: false,
    force: false, verifyImages: undefined }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') {
      args.check = true
      continue
    }
    if (a === '--compose-bg') {
      args.composeBg = true
      continue
    }
    if (a === '--all') {
      args.all = true
      continue
    }
    if (a === '--force') {
      args.force = true
      continue
    }
    if (a === '--verify-images') {
      if (i + 1 >= argv.length) throw new Error('--verify-images requires a directory')
      args.verifyImages = argv[++i]
      continue
    }
    if (a === '--compose-bg') {
      args.composeBg = true
      continue
    }
    if (a === '--walk-grid') {
      args.walkGrid = true
      continue
    }
    // 带值参数缺值时报错，不静默回退默认。
    if (i + 1 >= argv.length) throw new Error(`${a} requires a value`)
    if (a === '--input') args.input = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--ts') args.ts = argv[++i]
    else if (a === '--map') args.map = argv[++i]
    else if (a === '--ase') args.ase = argv[++i]
    else if (a === '--ref') args.ref = argv[++i]
    else if (a === '--gap') args.gap = Number(argv[++i])
    else if (a === '--min-area') args.minArea = Number(argv[++i])
    else if (a === '--max-width') args.maxWidth = Number(argv[++i])
    else throw new Error(`unknown argument ${a}`)
  }
  validateParams(args)
  return args
}

function validateParams(args) {
  const requireInt = (name, value, min) => {
    if (!Number.isInteger(value) || value < min) {
      throw new Error(`--${name} must be an integer >= ${min}, got ${value}`)
    }
  }
  requireInt('gap', args.gap, 0)
  requireInt('min-area', args.minArea, 1)
  requireInt('max-width', args.maxWidth, 1)
}

// 默认输入：从脚本目录向上找仓库根下的 .agents/tmp 素材；可用 --input 或环境变量覆盖。
function resolveInput(explicit) {
  if (explicit) return resolve(explicit)
  if (process.env.PIXEL_OFFICE_ASSETS) return resolve(process.env.PIXEL_OFFICE_ASSETS)
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, DEFAULT_ASSET_RELPATH)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('source asset not found (--check needs it too); pass --input or PIXEL_OFFICE_ASSETS')
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')

// bbox 取证 dump 放仓库根的 .agents/tmp（不入库）；找不到该目录就跳过。
function resolveDumpPath() {
  let dir = scriptDir
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, '.agents/tmp')
    if (existsSync(candidate)) return join(candidate, 'pixel-atlas-bboxes.json')
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

function resolveDefaults(args) {
  return {
    input: resolveInput(args.input),
    outDir: args.out ? resolve(args.out) : join(packageDir, 'src/client/assets'),
    tsPath: args.ts ? resolve(args.ts) : join(packageDir, 'src/client/core/pixel/atlas-map.generated.ts'),
    mapPath: args.map ? resolve(args.map) : join(scriptDir, 'pixel-atlas.map.json'),
  }
}

const SEMANTIC_ID_RE = /^[a-z0-9][a-z0-9-]*$/

function loadMap(mapPath) {
  if (!existsSync(mapPath)) throw new Error(`semantic map missing: ${mapPath}`)
  const raw = JSON.parse(readFileSync(mapPath, 'utf8'))
  const map = new Map()
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value?.id !== 'string' || !SEMANTIC_ID_RE.test(value.id) || !SHEETS.includes(value.sheet)) {
      throw new Error(`bad map entry for ${key}: id must match ${SEMANTIC_ID_RE}, sheet in ${SHEETS}`)
    }
    if (map.has(value.id)) throw new Error(`duplicate semantic id ${value.id}`)
    if (value.pivot !== undefined) {
      if (!Array.isArray(value.pivot) || value.pivot.length !== 2) {
        throw new Error(`bad pivot for ${key}: must be a [x, y] array`)
      }
      const [px, py] = value.pivot
      if (!Number.isInteger(px) || !Number.isInteger(py) || px < 0 || py < 0) {
        throw new Error(`bad pivot for ${key}: must be two non-negative integers`)
      }
    }
    map.set(key, value)
  }
  return map
}

const bboxKey = (c) => `${c.x},${c.y},${c.w},${c.h}`

function buildEntries(comps, map) {
  const unmapped = []
  const entries = []
  for (const c of comps) {
    const hit = map.get(bboxKey(c))
    if (!hit) {
      unmapped.push(c)
      continue
    }
    // 家具锚点取左上角；角色锚点取脚底中心（与设计 6.4 一致）。
    const pivot = hit.pivot ?? (hit.sheet === 'chars' ? [Math.floor(c.w / 2), c.h] : [0, 0])
    if (pivot[0] > c.w - 1 || pivot[1] > c.h) {
      throw new Error(`pivot out of rect for ${hit.id} (${bboxKey(c)}): [${pivot[0]},${pivot[1]}]`)
    }
    entries.push({
      id: hit.id,
      sheet: hit.sheet,
      x0: c.x,
      y0: c.y,
      w: c.w,
      h: c.h,
      pivotX: pivot[0],
      pivotY: pivot[1],
    })
  }
  entries.sort((a, b) => (a.sheet === b.sheet ? (a.id < b.id ? -1 : 1) : a.sheet < b.sheet ? -1 : 1))
  return { entries, unmapped }
}

function generateTs({ sourceSha256, sizes, entries, params, bg }) {
  const sheetLines = SHEETS.map((s) => `  ${s}: { width: ${sizes[s].width}, height: ${sizes[s].height} },`)
  sheetLines.push(`  bg: { width: ${bg.width}, height: ${bg.height} },`)
  const lines = []
  for (const e of entries) {
    lines.push(
      `  { id: '${e.id}', sheet: '${e.sheet}', x: ${e.x}, y: ${e.y}, w: ${e.w}, h: ${e.h}, ` +
        `pivotX: ${e.pivotX}, pivotY: ${e.pivotY} },`,
    )
  }
  return [
    '// 生成文件：scripts/build-pixel-atlas.mjs，勿手改。',
    `export const ATLAS_SOURCE_SHA256 = '${sourceSha256}'`,
    `export const ATLAS_SCRIPT_VERSION = '${SCRIPT_VERSION}'`,
    `export const ATLAS_PARAMS = { gap: ${params.gap}, minArea: ${params.minArea}, maxWidth: ${params.maxWidth} } as const`,
    'export const ATLAS_SHEETS = {',
    ...sheetLines,
    "} as const",
    '',
    'export interface AtlasMapEntry {',
    '  id: string',
    "  sheet: 'env' | 'chars'",
    '  x: number',
    '  y: number',
    '  w: number',
    '  h: number',
    '  pivotX: number',
    '  pivotY: number',
    '}',
    '',
    'export const ATLAS_ENTRIES: readonly AtlasMapEntry[] = [',
    ...lines,
    ']',
    '',
    `export const BG_SHA256 = '${bg.sha256}'`,
    '',
  ].join('\n')
}

/** bg 尺寸/sha 来自 placement.json（唯一真源）；缺失即报错（placement 随仓提交，不应缺失）。 */
function readBgMeta() {
  const placementPath = join(scriptDir, 'pixel-office.placement.json')
  if (!existsSync(placementPath)) {
    throw new Error('pixel-office.placement.json missing (it is committed; restore it or run --compose-bg)')
  }
  const placement = JSON.parse(readFileSync(placementPath, 'utf8'))
  return {
    width: placement.canvas?.width ?? 0,
    height: placement.canvas?.height ?? 0,
    sha256: placement.bgSha256 ?? '',
  }
}

function writeIfChanged(path, content) {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  if (existsSync(path) && readFileSync(path).equals(buf)) return false
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
  return true
}

function computePipeline(args, paths) {
  if (!existsSync(paths.input)) {
    throw new Error(`source asset not found: ${paths.input} (pass --input or PIXEL_OFFICE_ASSETS)`)
  }
  const inputBuf = readFileSync(paths.input)
  const sourceSha256 = createHash('sha256').update(inputBuf).digest('hex')
  const image = decodePng(inputBuf)
  const comps = findComponents(image.rgba, image.width, image.height, { gap: args.gap, minArea: args.minArea })
  const map = loadMap(paths.mapPath)
  const { entries, unmapped } = buildEntries(comps, map)
  return { image, sourceSha256, comps, map, entries, unmapped }
}

function buildOutputs(args, pipe) {
  const bySheet = {}
  for (const s of SHEETS) bySheet[s] = pipe.entries.filter((e) => e.sheet === s)
  const packed = {}
  for (const s of SHEETS) packed[s] = packAtlas(bySheet[s], args.maxWidth)
  const sizes = {}
  const pngBuffers = {}
  for (const s of SHEETS) {
    const size = packed[s].sizes[s] || { width: 0, height: 0 }
    if (size.width === 0) throw new Error(`sheet ${s} has no entries`)
    sizes[s] = size
    const rgba = renderAtlas(size, packed[s].placed, s, pipe.image.rgba, pipe.image.width)
    pngBuffers[s] = encodePng(rgba, size.width, size.height)
  }
  const placedEntries = pipe.entries.map((e) => {
    const hit = packed[e.sheet].placed.find((p) => p.id === e.id)
    return { ...e, x: hit.x, y: hit.y }
  })
  const params = { gap: args.gap, minArea: args.minArea, maxWidth: args.maxWidth }
  const ts = generateTs({ sourceSha256: pipe.sourceSha256, sizes, entries: placedEntries, params, bg: readBgMeta() })
  return { bySheet, sizes, pngBuffers, ts }
}

/** 脚本入口（可被测试直接调用）：argv 默认取 CLI 参数。 */
export function runBuild(argv) {
  const args = parseArgs(argv)
  const paths = resolveDefaults(args)
  // --compose-bg --check：先比对现有产物（不允许「先重写再自检」）；--force 才重新生成。
  if (args.composeBg) {
    if (args.check && !args.force) {
      checkComposeBg({ paths, args })
      return
    }
    runComposeBg({ paths, args })
    if (args.check) checkComposeBg({ paths, args })
    return
  }
  if (args.walkGrid) {
    // --walk-grid --check：只比对生成物（逐字），不重写；不带 --check 才落盘。
    runWalkGrid({ paths, check: args.check && !args.force })
    return
  }
  if (args.check) {
    // 纯 --check：atlas 一致性 + bg（sha/alpha/角色门禁/除掩码外一致）。
    const pipe = computePipeline(args, paths)
    runCheck({ paths, pipe, args })
    checkComposeBg({ paths, args })
    return
  }
  if (args.all) {
    // 一条命令：先 compose-bg（placement 先行，atlas 生成物需要 bg 元数据），再 atlas，再可行走网格。
    runComposeBg({ paths, args })
    const pipe = computePipeline(args, paths)
    runAtlasBuild({ paths, pipe, args })
    runWalkGrid({ paths })
    return
  }
  const pipe = computePipeline(args, paths)
  runAtlasBuild({ paths, pipe, args })
}

function runAtlasBuild({ paths, pipe, args }) {
  const compsDumpPath = resolveDumpPath()
  if (compsDumpPath !== null) {
    const compsDump = JSON.stringify({
      scriptVersion: SCRIPT_VERSION,
      sourceSha256: pipe.sourceSha256,
      input: paths.input,
      params: { gap: args.gap, minArea: args.minArea, maxWidth: args.maxWidth },
      components: pipe.comps,
      unmapped: pipe.unmapped.map(bboxKey),
    }, null, 2) + '\n'
    writeIfChanged(compsDumpPath, compsDump)
  }
  if (pipe.unmapped.length > 0) {
    const listing = pipe.unmapped.map((c) => `${bboxKey(c)} area=${c.area}`).join('\n  ')
    throw new Error(
      `${pipe.unmapped.length} unmapped component(s) — edit ${paths.mapPath}` +
        (compsDumpPath ? `; bboxes dump at ${compsDumpPath}` : '') +
        `:\n  ${listing}`,
    )
  }
  const outputs = buildOutputs(args, pipe)
  const wrote = []
  for (const s of SHEETS) {
    if (writeIfChanged(join(paths.outDir, `pixel-office.${s}.png`), outputs.pngBuffers[s])) wrote.push(s)
  }
  if (writeIfChanged(paths.tsPath, outputs.ts)) wrote.push('atlas-map.generated.ts')
  console.log(`[atlas] source ${pipe.image.width}x${pipe.image.height} sha=${pipe.sourceSha256.slice(0, 12)}…`)
  console.log(`[atlas] components=${pipe.comps.length} entries=${pipe.entries.length}`)
  for (const s of SHEETS) {
    console.log(`[atlas] ${s}: ${outputs.sizes[s].width}x${outputs.sizes[s].height} entries=${outputs.bySheet[s].length}`)
  }
  console.log(`[atlas] wrote: ${wrote.length > 0 ? wrote.join(', ') : 'nothing changed'}`)
}

// ---- --compose-bg：aseprite 解析 + 无人物背景合成 ----

function parseAsepriteFile(path) {
  const data = readFileSync(path)
  if (data.readUInt16LE(4) !== 0xa5e0) throw new Error('not an aseprite file')
  const info = { width: data.readUInt16LE(8), height: data.readUInt16LE(10), layers: [], cels: [] }
  if (data.readUInt16LE(12) !== 32) throw new Error('unsupported aseprite depth (need 32bpp)')
  const frames = data.readUInt16LE(6)
  let pos = 128
  for (let f = 0; f < frames; f++) {
    const fbytes = data.readUInt32LE(pos)
    const oldChunks = data.readUInt16LE(pos + 6)
    const newChunks = data.readUInt32LE(pos + 12)
    const nChunks = newChunks !== 0 && (newChunks & 0x80000000) === 0 ? newChunks : oldChunks
    let cp = pos + 16
    for (let c = 0; c < nChunks; c++) {
      const csize = data.readUInt32LE(cp)
      const ctype = data.readUInt16LE(cp + 4)
      const body = data.subarray(cp + 6, cp + csize)
      if (ctype === 0x2004) {
        const nameLen = body.readUInt16LE(16)
        info.layers.push({ index: info.layers.length, name: body.subarray(18, 18 + nameLen).toString('utf8') })
      } else if (ctype === 0x2005) {
        const layerIndex = body.readUInt16LE(0)
        const x = body.readInt16LE(2)
        const y = body.readInt16LE(4)
        const celType = body.readUInt16LE(7)
        let w = 0
        let h = 0
        let pixels = null
        if (celType === 0) {
          w = body.readUInt16LE(9)
          h = body.readUInt16LE(11)
          pixels = body.subarray(13, 13 + w * h * 4)
        } else if (celType === 2) {
          const zpos = body.indexOf(Buffer.from([0x78, 0x9c]), 9)
          if (zpos >= 13) {
            w = body.readUInt16LE(zpos - 4)
            h = body.readUInt16LE(zpos - 2)
            pixels = inflateSync(body.subarray(zpos)).subarray(0, w * h * 4)
          } else {
            w = body.readUInt16LE(9)
            h = body.readUInt16LE(11)
            pixels = inflateSync(body.subarray(13)).subarray(0, w * h * 4)
          }
        }
        if (pixels !== null && pixels.length === w * h * 4) {
          info.cels.push({ layer: layerIndex, layerName: info.layers[layerIndex]?.name ?? '',
            x, y, w, h, pixels: new Uint8Array(pixels) })
        }
      }
      cp += csize
    }
    pos += fbytes
  }
  return info
}

function rectIntersects(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

function rectOverlapRatio(a, b) {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return 0
  return ((x1 - x0) * (y1 - y0)) / Math.min(a.w * a.h, b.w * b.h)
}

/** 角色 sprite 模板（含水平翻转）：预提取不透明像素的相对偏移与颜色。 */
function charTemplates(assetsPng, semanticTableXY) {
  const out = []
  for (const [sid, [sx, sy, sw, sh]] of Object.entries(semanticTableXY)) {
    if (!sid.startsWith('char-')) continue
    for (const flip of [false, true]) {
      const px = []
      for (let dy = 0; dy < sh; dy++) {
        for (let dx = 0; dx < sw; dx++) {
          const sxx = flip ? sx + sw - 1 - dx : sx + dx
          const o = ((sy + dy) * assetsPng.width + sxx) * 4
          if (assetsPng.rgba[o + 3] === 0) continue
          px.push([dx, dy, assetsPng.rgba[o], assetsPng.rgba[o + 1], assetsPng.rgba[o + 2]])
        }
      }
      out.push({ sprite: sid, flip, w: sw, h: sh, px })
    }
  }
  return out
}

/**
 * 角色模板滑窗匹配：tolerancePct = 允许的颜色不匹配像素占不透明像素的百分比上限。
 * 命中框互相覆盖 >30% 时保留 mismatch 更低者。
 */
function detectCharHits(sceneRgba, W, H, templates, region, tolerancePct) {
  const { x0, y0, x1, y1 } = region
  const hits = []
  for (const t of templates) {
    const thresh = Math.max(0, Math.floor((t.px.length * tolerancePct) / 100))
    for (let cy = y0; cy + t.h <= y1; cy++) {
      for (let cx = x0; cx + t.w <= x1; cx++) {
        let mismatch = 0
        for (let i = 0; i < t.px.length; i++) {
          const [dx, dy, r, g, b] = t.px[i]
          const o = ((cy + dy) * W + (cx + dx)) * 4
          if (sceneRgba[o] !== r || sceneRgba[o + 1] !== g || sceneRgba[o + 2] !== b) {
            mismatch++
            if (mismatch > thresh) break
          }
        }
        if (mismatch <= thresh) {
          hits.push({ sprite: t.sprite, flip: t.flip, x: cx, y: cy, w: t.w, h: t.h, mismatch, opaque: t.px.length })
        }
      }
    }
  }
  hits.sort((a, b) => a.mismatch - b.mismatch)
  const kept = []
  for (const p of hits) {
    if (!kept.some((q) => rectOverlapRatio(p, q) > 0.3)) kept.push(p)
  }
  return kept
}

/**
 * 填补 v4（同相位列补全）：地板竖纹周期 8px、墙 10px——每个掩码像素从同 x、
 * 同相位（y±period·k）的最近未掩码行取色，横缝/竖结构/相位全保留，无碎片。
 */
function eraseAndFill(bg, refRgba, refW, refH, rects, furnitureRects) {
  const isMasked = (x, y) => rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  const isBlocked = (x, y) =>
    isMasked(x, y) || furnitureRects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  for (const rect of rects) {
    // 坐姿种子区（pod 内部，椅子/桌子被角色遮挡、逐像素不可恢复）：整块从相邻带
    // （同 pod 结构自洽）位移拷贝；源不得含角色像素（掩码避让），家具像素随块带过。
    if (rect.id.startsWith('seed-')) {
      for (const dy of [31, -31]) {
        const sy = rect.y + dy
        const srcRect = { x: rect.x, y: sy, w: rect.w, h: rect.h }
        if (sy < 0 || sy + rect.h > refH) continue
        if (rects.some((r) => rectIntersects(srcRect, r))) continue
        for (let y = 0; y < rect.h; y++) {
          bg.set(bg.subarray(((sy + y) * refW + rect.x) * 4, ((sy + y) * refW + rect.x + rect.w) * 4),
            ((rect.y + y) * refW + rect.x) * 4)
        }
        break
      }
      continue
    }
    for (let y = rect.y; y < rect.y + rect.h && y < refH; y++) {
      // 墙区（y<120）：同构的墙饰（白板点阵）会污染竖向补全 → 用同一行最近干净列水平补。
      if (y < 120) {
        let color = null
        for (const dir of [1, -1]) {
          for (let d = rect.w; d <= 48; d++) {
            const sx = dir > 0 ? rect.x + rect.w - 1 + d : rect.x - d
            if (sx < 0 || sx >= refW || isBlocked(sx, y)) continue
            const p = (y * refW + sx) * 4
            color = [refRgba[p], refRgba[p + 1], refRgba[p + 2]]
            break
          }
          if (color !== null) break
        }
        if (color !== null) {
          for (let x = rect.x; x < Math.min(rect.x + rect.w, refW); x++) {
            const o = (y * refW + x) * 4
            bg[o] = color[0]; bg[o + 1] = color[1]; bg[o + 2] = color[2]; bg[o + 3] = 255
          }
        }
        continue
      }
      // 地板区（y≥120）：同相位竖向补全（竖纹周期 8px，横缝/相位全保留）。
      const period = 8
      for (let x = rect.x; x < Math.min(rect.x + rect.w, refW); x++) {
        let done = false
        for (let k = 1; !done && k <= 6; k++) {
          for (const sy of [y - k * period, y + k * period]) {
            if (sy < 120 || sy >= refH) continue
            if (isMasked(x, sy)) continue
            const o = (y * refW + x) * 4
            const p = (sy * refW + x) * 4
            bg[o] = refRgba[p]; bg[o + 1] = refRgba[p + 1]; bg[o + 2] = refRgba[p + 2]; bg[o + 3] = 255
            done = true
            break
          }
        }
        if (done) continue
        // 同列同相位耗尽（整列被掩码）：水平最近未掩码像素。
        for (const dx of [...Array(rect.w).keys()].map((i) => -i - 1)) {
          const sx = x + dx
          if (sx < 0 || isMasked(sx, y)) continue
          const o = (y * refW + x) * 4
          const p = (y * refW + sx) * 4
          bg[o] = refRgba[p]; bg[o + 1] = refRgba[p + 1]; bg[o + 2] = refRgba[p + 2]; bg[o + 3] = 255
          break
        }
        for (const dx of [...Array(rect.w).keys()].map((i) => i + 1)) {
          const sx = x + dx
          if (sx >= refW || isMasked(sx, y)) continue
          const o = (y * refW + x) * 4
          const p = (y * refW + sx) * 4
          bg[o] = refRgba[p]; bg[o + 1] = refRgba[p + 1]; bg[o + 2] = refRgba[p + 2]; bg[o + 3] = 255
          break
        }
      }
    }
  }
}

/** 家具精确命中：非角色 sprite 在 ref 中的所有出现位置（重 blit 与 placement 表用）。 */
function furnitureOccurrences(refPng, assetsPng, semanticTable) {
  const counts = new Map()
  for (let i = 0; i < refPng.rgba.length; i += 4) {
    const k = `${refPng.rgba[i]},${refPng.rgba[i + 1]},${refPng.rgba[i + 2]}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const out = []
  for (const [sid, [sx, sy, sw, sh]] of Object.entries(semanticTable)) {
    if (sid.startsWith('char-')) continue
    let sig = null
    let sigN = Infinity
    for (let dy = 0; dy < sh; dy++) {
      for (let dx = 0; dx < sw; dx++) {
        if (assetsPng.rgba[((sy + dy) * assetsPng.width + (sx + dx)) * 4 + 3] === 0) continue
        const o = ((sy + dy) * assetsPng.width + (sx + dx)) * 4
        const k = `${assetsPng.rgba[o]},${assetsPng.rgba[o + 1]},${assetsPng.rgba[o + 2]}`
        const n = counts.get(k) ?? 0
        if (sigN === Infinity || n < sigN) { sigN = n; sig = o }
      }
    }
    if (sig === null) continue
    const candidates = []
    for (let i = 0; i < refPng.rgba.length; i += 4) {
      if (refPng.rgba[i] === assetsPng.rgba[sig] && refPng.rgba[i + 1] === assetsPng.rgba[sig + 1] &&
          refPng.rgba[i + 2] === assetsPng.rgba[sig + 2]) candidates.push(i)
    }
    const sigDx = (sig / 4) % assetsPng.width - sx
    const sigDy = Math.floor(sig / 4 / assetsPng.width) - sy
    for (let base of candidates) {
      let cx = (base / 4) % refPng.width - sigDx
      const cy = Math.floor(base / 4 / refPng.width) - sigDy
      if (cx < 0 || cy < 0 || cx + sw > refPng.width || cy + sh > refPng.height) continue
      let ok = true
      for (let dy = 0; dy < sh && ok; dy++) {
        for (let dx = 0; dx < sw; dx++) {
          const so = ((sy + dy) * assetsPng.width + (sx + dx)) * 4
          const ro = ((cy + dy) * refPng.width + (cx + dx)) * 4
          if (assetsPng.rgba[so + 3] === 0) continue
          if (refPng.rgba[ro] !== assetsPng.rgba[so] || refPng.rgba[ro + 1] !== assetsPng.rgba[so + 1] ||
              refPng.rgba[ro + 2] !== assetsPng.rgba[so + 2]) { ok = false; break }
        }
      }
      if (ok) { out.push({ sprite: sid, x: cx, y: cy }); cx += sw - 1 }
    }
  }
  return out
}

/** 坐姿变体种子（角色不在 assets 图集里，无法模板匹配；bbox 人工目检确认）。 */
const POSE_VARIANT_SEEDS = [
  { sprite: 'char-3-sitting', flip: false, x: 41, y: 167, w: 16, h: 27, reason: 'pose-variant' },
]

/** 角色检测区（角色只出现在 y>=90 的墙沿/地板带）。 */
const CHAR_DETECT_REGION = { x0: 0, y0: 90, x1: 256, y1: 224 }

/** worker 分层目录解析（从脚本目录向上找仓库根）。 */
function resolveWorkerDir() {
  let dir = scriptDir
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, '.agents/tmp/pixel-assets/worker')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('worker layers not found (.agents/tmp/pixel-assets/worker)')
}

/** 层合成（纯函数）：bg 整幅来源 = worker/bg-source.png（美术整图，分层管线已退役）。 */
function composeWorkerBg() {
  const workerDir = resolveWorkerDir()
  const W = 256
  const H = 224
  const bg = decodePng(readFileSync(join(workerDir, 'bg-source.png')))
  if (bg.width !== W || bg.height !== H) {
    throw new Error(`bg-source.png must be ${W}x${H}, got ${bg.width}x${bg.height}`)
  }
  for (let i = 3; i < bg.rgba.length; i += 4) {
    if (bg.rgba[i] !== 255) throw new Error('bg compose left transparent pixels')
  }
  return { bg: Buffer.from(bg.rgba), W, H, workerDir }
}

function runComposeBg({ paths }) {
  const { bg, W, H, workerDir } = composeWorkerBg()
  const bgPng = encodePng(bg, W, H)
  const bgSha = createHash('sha256').update(bgPng).digest('hex')
  // 素材指纹 = bg 整图来源文件哈希（任一改动都会使 placement 过期）。
  const layerSha = createHash('sha256')
  layerSha.update(readFileSync(join(workerDir, 'bg-source.png')))
  const placement = {
    canvas: { width: W, height: H, cell: 8 },
    bgSha256: bgSha,
    layersSha256: layerSha.digest('hex'),
    seats: BG_SEATS,
    lead: BG_LEAD,
    overflow: BG_OVERFLOW,
  }
  writeIfChanged(join(scriptDir, 'pixel-office.placement.json'), JSON.stringify(placement, null, 1) + '\n')
  writeSeatsGenerated(placement)
  if (writeIfChanged(join(paths.outDir, 'pixel-office.bg.png'), bgPng)) console.log('[compose-bg] bg written')
  console.log('[compose-bg] bg composited from bg-source.png')
}

function buildSeatsGeneratedTs(placement) {
  const seats = Object.entries(placement.seats)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([id, s]) => ({ ...s, id: `seat-${id}` }))
  const lines = seats.map((s) =>
    `  { id: '${s.id}', order: ${s.order}, anchor: [${s.x}, ${s.y}], ` +
    `station: [${s.station[0]}, ${s.station[1]}, ${s.station[2]}, ${s.station[3]}] },`)
  const lead = placement.lead
  const overflow = placement.overflow
  return [
    '// 生成文件：scripts/build-pixel-atlas.mjs --compose-bg（真源 = pixel-office.placement.json），勿手改。',
    'export interface GeneratedSeatSeed {',
    '  id: string',
    '  order: number',
    '  anchor: [number, number]',
    '  station: [number, number, number, number]',
    '}',
    '',
    'export const GENERATED_SEAT_SEEDS: readonly GeneratedSeatSeed[] = [',
    ...lines,
    ']',
    '',
    `export const GENERATED_LEAD_SEED: GeneratedSeatSeed = { id: 'lead', order: 0, anchor: [${lead.x}, ${lead.y}], ` +
      `station: [${lead.station[0]}, ${lead.station[1]}, ${lead.station[2]}, ${lead.station[3]}] }`,
    '',
    `export const GENERATED_OVERFLOW = { x: ${overflow.x}, y: ${overflow.y}, step: ${overflow.step}, capacity: ${overflow.capacity}, ` +
      `station: [${overflow.station[0]}, ${overflow.station[1]}, ${overflow.station[2]}, ${overflow.station[3]}], ` +
      `labelAnchor: [${overflow.x + 1}, ${overflow.station[1] - 4}] } as const`,
    '',
  ].join('\n')
}

function writeSeatsGenerated(placement) {
  const outPath = join(scriptDir, '..', 'src/client/core/pixel/scene-office-slots.generated.ts')
  if (writeIfChanged(outPath, buildSeatsGeneratedTs(placement))) {
    console.log('[compose-bg] seats generated → scene-office-slots.generated.ts')
  }
}

/** 人工验证据：整图 4×（2×2 分块带间隔）+ 各可疑区域 before/after 4× 裁剪。仅显式 --verify-images <dir> 时输出。 */
function writeBgVerifyImages(bg, refPng, eraseRects, outDir) {
  const S = 4
  const W = refPng.width
  const H = refPng.height
  const put4x = (dst, dstW, srcRgba, sx, sy, sw, sh, ox, oy) => {
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const o = ((sy + y) * W + (sx + x)) * 4
        for (let dy = 0; dy < S; dy++) {
          for (let dx = 0; dx < S; dx++) {
            const d = ((oy + y * S + dy) * dstW + (ox + x * S + dx)) * 4
            dst[d] = srcRgba[o]; dst[d + 1] = srcRgba[o + 1]; dst[d + 2] = srcRgba[o + 2]; dst[d + 3] = 255
          }
        }
      }
    }
  }
  // 整图 2×2 分块（每块 128×112 @4x = 512×448），块间 8px 红色间隔便于对位。
  const tileW = 128 * S
  const tileH = 112 * S
  const gap = 8
  const dstW = tileW * 2 + gap * 3
  const dstH = tileH * 2 + gap * 3
  const out = Buffer.alloc(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const o = (y * dstW + x) * 4
      out[o] = 30; out[o + 1] = 30; out[o + 2] = 34; out[o + 3] = 255
    }
  }
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      put4x(out, dstW, bg, tx * 128, ty * 112, 128, 112, gap + tx * (tileW + gap), gap + ty * (tileH + gap))
    }
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'bg_verify_4x.png'), encodePng(out, dstW, dstH))
  // 各可疑区域 before/after 4× 并排（左=参考含人物，右=bg 已擦除）。
  const regions = [
    { id: 'reception', x: 60, y: 90, w: 44, h: 45 },
    { id: 'sofa-wall', x: 98, y: 95, w: 50, h: 40 },
    { id: 'right-aisle', x: 208, y: 125, w: 44, h: 40 },
    { id: 'aisle-row2', x: 98, y: 158, w: 48, h: 42 },
    { id: 'sitting', x: 32, y: 158, w: 34, h: 42 },
  ]
  for (const r of regions) {
    const cw = r.w * S
    const ch = r.h * S
    const combo = Buffer.alloc((cw * 2 + 8) * ch * 4)
    for (let i = 0; i < combo.length; i += 4) combo[i + 3] = 255
    put4x(combo, cw * 2 + 8, refPng.rgba, r.x, r.y, r.w, r.h, 0, 0)
    put4x(combo, cw * 2 + 8, bg, r.x, r.y, r.w, r.h, cw + 8, 0)
    writeFileSync(join(outDir, `bg_verify_region_${r.id}.png`), encodePng(combo, cw * 2 + 8, ch))
  }
  console.log(`[compose-bg] verify images written (regions=${regions.length}, eraseRects=${eraseRects.length})`)
}

/** 出座通道最多向外搜索的格数（座位格 → 最近地板格）。 */
const WALK_GRID_CARVE_MAX_STEPS = 6
/** 单座位出座通道允许的「新增 carve 格」上限。 */
const WALK_GRID_EXIT_MAX_COST = 2
/** 连接通道（地板分量之间）允许的「新增 carve 格」总代价上限。
 *  暖沙地板（单色判定）后家具严格 blocked，工位内部走道成为小分量；
 *  实测需 3 格（右块 C/D 排间走道 2 格 + leader 区右口袋 1 格），仍远小于横穿整排工位。 */
const WALK_GRID_CONNECTOR_MAX_COST = 3

/** bg 纯地板判定：地板色集合内像素占比 ≥ 阈值（Lead 取证口径）。
 *  bg-source 整图（美术直出）：浅灰紫地板 #c2c2d1（非 Sweetie16，家具/白墙均不含此色，
 *  主题 LUT 也不会重映射它——地板亮度跨主题恒定）；白墙与家具自然 blocked。 */
const WALK_FLOOR_COLORS = new Set(['c2c2d1'])
const WALK_FLOOR_RATIO = 0.6
/** 地板带起点：canvas 上方是天空/墙/接待台，不参与游走。 */
const WALK_FLOOR_MIN_Y = 24
/** 格子分类：0=floor / 1=blocked / 2=carve / 3=seat。 */
const WALK_KIND_FLOOR = 0
const WALK_KIND_BLOCKED = 1
const WALK_KIND_CARVE = 2
const WALK_KIND_SEAT = 3
/** 4 邻接（顺序固定，保证生成物确定性）。 */
const WALK_DIRS = [[0, -1], [-1, 0], [1, 0], [0, 1]]

/**
 * 0-1 BFS：座位格 → 最近地板格。进入 blocked 格代价 1，进入其它格代价 0；
 * 目标必须是 kind===floor（起点座位格除外）。超出步数/代价上限视为无解。
 */
function findExitChannel(kind, cols, rows, startCol, startRow) {
  const start = startRow * cols + startCol
  const dist = new Int32Array(kind.length).fill(-1)
  const depth = new Int32Array(kind.length)
  const prev = new Int32Array(kind.length).fill(-1)
  dist[start] = 0
  const deque = [start]
  let goal = -1
  while (deque.length > 0) {
    const k = deque.shift()
    if (k !== start && kind[k] === WALK_KIND_FLOOR) {
      goal = k
      break
    }
    if (depth[k] >= WALK_GRID_CARVE_MAX_STEPS) continue
    const col = k % cols
    const row = Math.floor(k / cols)
    const cost = dist[k]
    for (const [dc, dr] of WALK_DIRS) {
      const nc = col + dc
      const nr = row + dr
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const nk = nr * cols + nc
      if (nk !== start && kind[nk] === WALK_KIND_SEAT) continue
      const step = kind[nk] === WALK_KIND_BLOCKED ? 1 : 0
      const next = cost + step
      if (next > WALK_GRID_EXIT_MAX_COST) continue
      if (dist[nk] !== -1 && dist[nk] <= next) continue
      dist[nk] = next
      depth[nk] = depth[k] + 1
      prev[nk] = k
      if (step === 0) deque.unshift(nk)
      else deque.push(nk)
    }
  }
  if (goal < 0) return null
  const path = []
  let k = goal
  while (k !== start) {
    path.push(k)
    k = prev[k]
  }
  return { cost: dist[goal], path: path.reverse() }
}

/**
 * 0-1 BFS：多源 = 所有非主分量的可走格，目标 = 主分量；进入 blocked 格代价 1。
 * 返回连接路径（不含源格、含目标格）与新增 carve 代价；无解返回 null。
 */
function findConnector(kind, comp, cols, rows, mainId) {
  const dist = new Int32Array(kind.length).fill(-1)
  const prev = new Int32Array(kind.length).fill(-1)
  const deque = []
  for (let k = 0; k < kind.length; k++) {
    if (comp[k] >= 0 && comp[k] !== mainId) {
      dist[k] = 0
      deque.push(k)
    }
  }
  let goal = -1
  while (deque.length > 0) {
    const k = deque.shift()
    if (comp[k] === mainId) {
      goal = k
      break
    }
    const col = k % cols
    const row = Math.floor(k / cols)
    const cost = dist[k]
    for (const [dc, dr] of WALK_DIRS) {
      const nc = col + dc
      const nr = row + dr
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const nk = nr * cols + nc
      if (kind[nk] === WALK_KIND_SEAT) continue
      const step = kind[nk] === WALK_KIND_BLOCKED ? 1 : 0
      const next = cost + step
      if (dist[nk] !== -1 && dist[nk] <= next) continue
      dist[nk] = next
      prev[nk] = k
      if (step === 0) deque.unshift(nk)
      else deque.push(nk)
    }
  }
  if (goal < 0) return null
  const path = []
  let k = goal
  while (prev[k] !== -1) {
    path.push(k)
    k = prev[k]
  }
  return { cost: dist[goal], path: path.reverse() }
}

/** 4 邻接可走分量（kind !== blocked）；扫描序保证确定性。 */
function walkComponents(kind, cols, rows) {
  const comp = new Int32Array(kind.length).fill(-1)
  const comps = []
  for (let k = 0; k < kind.length; k++) {
    if (kind[k] === WALK_KIND_BLOCKED || comp[k] !== -1) continue
    const id = comps.length
    const cells = [k]
    comp[k] = id
    for (let qi = 0; qi < cells.length; qi++) {
      const col = cells[qi] % cols
      const row = Math.floor(cells[qi] / cols)
      for (const [dc, dr] of WALK_DIRS) {
        const nc = col + dc
        const nr = row + dr
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        const nk = nr * cols + nc
        if (kind[nk] === WALK_KIND_BLOCKED || comp[nk] !== -1) continue
        comp[nk] = id
        cells.push(nk)
      }
    }
    comps.push(cells)
  }
  return { comp, comps }
}

/**
 * --walk-grid：真源 = pixel-office.bg.png 的纯地板像素（不再用 placement footprint 膨胀）。
 * 按地板色占比 ≥ 0.6 逐格分类：floor=0 / blocked=1 / carve=2 / seat=3。
 * - 出座通道：每个座位格用 0-1 BFS 连到最近地板格（新增 carve ≤2 格）。
 * - 连接通道：纯地板分量 > 1 时用 0-1 BFS 找最小 carve 代价路径（总代价 ≤2），
 *   不再无条件横穿 blocked 工位（reviewer P1）。
 * 生成期门禁：所有座位与全部可走格必须同属一个连通分量，否则构建 FAIL。
 */
function runWalkGrid({ paths, check = false }) {
  const placementPath = join(scriptDir, 'pixel-office.placement.json')
  if (!existsSync(placementPath)) {
    console.error('[walk-grid] FAIL: placement missing (run --compose-bg first)')
    process.exit(1)
  }
  const placement = JSON.parse(readFileSync(placementPath, 'utf8'))
  const COLS = 32
  const ROWS = 28
  const CELL = 8
  // 真源 = bg（--compose-bg 产物）：只有真实地板像素才能成为游走目标；家具/隔断由
  // 「非地板色」自然挡开，不再用 placement footprint 膨胀（旧实现会横穿 A/C 工位）。
  const bgPath = join(paths.outDir, 'pixel-office.bg.png')
  if (!existsSync(bgPath)) {
    console.error('[walk-grid] FAIL: bg missing (run --compose-bg first)')
    process.exit(1)
  }
  const bg = decodePng(readFileSync(bgPath))
  if (bg.width < COLS * CELL || bg.height < ROWS * CELL) {
    console.error(`[walk-grid] FAIL: bg ${bg.width}x${bg.height} smaller than ${COLS * CELL}x${ROWS * CELL}`)
    process.exit(1)
  }
  const cellKey = (col, row) => row * COLS + col
  const pixelHex = (x, y) => {
    const o = (y * bg.width + x) * 4
    return [bg.rgba[o], bg.rgba[o + 1], bg.rgba[o + 2]]
      .map((v) => v.toString(16).padStart(2, '0')).join('')
  }
  const kind = new Array(COLS * ROWS).fill(WALK_KIND_BLOCKED)
  let floorCells = 0
  for (let row = 0; row < ROWS; row++) {
    if (row * CELL < WALK_FLOOR_MIN_Y) continue
    for (let col = 0; col < COLS; col++) {
      let hit = 0
      for (let y = row * CELL; y < row * CELL + CELL; y++) {
        for (let x = col * CELL; x < col * CELL + CELL; x++) {
          if (WALK_FLOOR_COLORS.has(pixelHex(x, y))) hit++
        }
      }
      if (hit / (CELL * CELL) >= WALK_FLOOR_RATIO) {
        kind[cellKey(col, row)] = WALK_KIND_FLOOR
        floorCells++
      }
    }
  }
  // 座位 foot 锚点：8 工位 + lead + overflow 每个沙发座（step 展开）。
  const seatPoints = [
    ...Object.entries(placement.seats).map(([id, s]) => ({ id, x: s.x, y: s.y })),
    { id: 'lead', x: placement.lead.x, y: placement.lead.y },
    ...Array.from({ length: placement.overflow.capacity }, (_, i) => ({
      id: `overflow-${i + 1}`,
      x: placement.overflow.x + i * placement.overflow.step,
      y: placement.overflow.y,
    })),
  ]
  const seatCellOf = (seat) => ({
    col: Math.floor(seat.x / CELL),
    row: Math.floor(seat.y / CELL),
  })
  // 座位 foot 格优先于地板：可通行，但不可作为游走目标（wander 只选 kind===0）。
  for (const seat of seatPoints) {
    const { col, row } = seatCellOf(seat)
    kind[cellKey(col, row)] = WALK_KIND_SEAT
  }
  const carveCell = (k) => {
    if (kind[k] === WALK_KIND_BLOCKED) kind[k] = WALK_KIND_CARVE
  }
  // 新布局：办公区两排背靠背、座位深在桌带内——沿椅子列向最近的开阔地板 carve
  // 直走廊（近顶带向北、近下延地板向南），走廊可通行但不可作游走目标。
  for (const seat of seatPoints) {
    const { col, row } = seatCellOf(seat)
    const isFloor = (c, r) => kind[cellKey(c, r)] === WALK_KIND_FLOOR
    let north = -1
    for (let r = row - 1; r >= 0; r--) {
      if (isFloor(col, r)) { north = row - r; break }
    }
    let south = -1
    for (let r = row + 1; r < ROWS; r++) {
      if (isFloor(col, r)) { south = r - row; break }
    }
    if (north === -1 && south === -1) continue
    const goNorth = south === -1 || (north !== -1 && north <= south)
    for (let i = 1; i <= (goNorth ? north : south); i++) {
      carveCell(cellKey(col, goNorth ? row - i : row + i))
    }
  }
  const carvedBySeat = new Map()
  const noExit = []
  for (const seat of seatPoints) {
    const { col: startCol, row: startRow } = seatCellOf(seat)
    const exit = findExitChannel(kind, COLS, ROWS, startCol, startRow)
    if (exit === null) {
      noExit.push(seat.id)
      carvedBySeat.set(seat.id, { cost: 0, cells: [] })
      continue
    }
    for (const k of exit.path) carveCell(k)
    carvedBySeat.set(seat.id, {
      cost: exit.cost,
      cells: [cellKey(startCol, startRow), ...exit.path]
        .map((k) => [k % COLS, Math.floor(k / COLS)]),
    })
  }
  // 连通分量 + 连接通道：可走格（floor/carve/seat）必须全图一个分量。
  const formatPath = (cells) => (cells.length === 0
    ? '(none)'
    : cells.map((k) => `(${k % COLS},${Math.floor(k / COLS)})`).join('→'))
  let { comp, comps } = walkComponents(kind, COLS, ROWS)
  const connectorCells = []
  let connectorCost = 0
  let connectorPass = 0
  while (comps.length > 1) {
    if (connectorPass >= 4) {
      console.error(`[walk-grid] FAIL: connector did not converge (${comps.length} components left)`)
      process.exit(1)
    }
    connectorPass += 1
    const mainId = comps.reduce(
      (best, cells, id) => (cells.length > comps[best].length ? id : best),
      0,
    )
    const linked = findConnector(kind, comp, COLS, ROWS, mainId)
    if (linked === null) {
      console.error(`[walk-grid] FAIL: cannot connect ${comps.length} walkable components`)
      process.exit(1)
    }
    if (connectorCost + linked.cost > WALK_GRID_CONNECTOR_MAX_COST) {
      // 预算用尽：把「不含座位的孤立地板口袋」降级为 blocked（pickTarget 按 planPath
      // 可达性过滤，游走者永远不会选它们），避免为连通口袋而 carve 横穿工位；
      // 含座位的分量不在降级之列——那种情况仍然 FAIL（座位被困是真问题）。
      const demoted = []
      for (let id = 0; id < comps.length; id++) {
        if (id === mainId) continue
        if (comps[id].some((k) => kind[k] === WALK_KIND_SEAT)) continue
        for (const k of comps[id]) {
          if (kind[k] === WALK_KIND_FLOOR) {
            kind[k] = WALK_KIND_BLOCKED
            demoted.push(k)
          }
        }
      }
      if (demoted.length === 0) {
        console.error(
          `[walk-grid] FAIL: connector total cost ${connectorCost + linked.cost} > ${WALK_GRID_CONNECTOR_MAX_COST} ` +
            `(pass ${connectorPass}: cost=${linked.cost} path=${formatPath(linked.path)})`,
        )
        process.exit(1)
      }
      ;({ comp, comps } = walkComponents(kind, COLS, ROWS))
      console.log(
        `[walk-grid] connector budget reached: demoted ${demoted.length} orphan floor cells ` +
          `(${formatPath(demoted)}) (components=${comps.length})`,
      )
      continue
    }
    connectorCost += linked.cost
    for (const k of linked.path) {
      if (kind[k] === WALK_KIND_BLOCKED) {
        kind[k] = WALK_KIND_CARVE
        connectorCells.push(k)
      }
    }
    ;({ comp, comps } = walkComponents(kind, COLS, ROWS))
    console.log(
      `[walk-grid] connector pass ${connectorPass}: cost=${linked.cost} ` +
        `${formatPath(linked.path)} (components=${comps.length})`,
    )
  }
  // 生成期门禁：所有座位都必须有出座通道，且全部可走格同属一个分量。
  const seatCompOf = (seat) => {
    const { col, row } = seatCellOf(seat)
    return comp[cellKey(col, row)]
  }
  const trapped = seatPoints.filter((seat) => {
    const id = seatCompOf(seat)
    return id === undefined || id < 0 || (comps[id]?.length ?? 0) < 2
  })
  const seatCompCount = new Set(seatPoints.map(seatCompOf)).size
  if (noExit.length > 0 || trapped.length > 0 || seatCompCount > 1 || comps.length !== 1) {
    for (const id of noExit) {
      console.error(
        `[walk-grid] FAIL: seat ${id} has no floor exit within ${WALK_GRID_CARVE_MAX_STEPS} cells ` +
          `(max carve cost ${WALK_GRID_EXIT_MAX_COST})`,
      )
    }
    for (const seat of trapped) {
      const id = seatCompOf(seat)
      const size = id === undefined || id < 0 ? 0 : (comps[id]?.length ?? 0)
      console.error(
        `[walk-grid] FAIL: seat ${seat.id} trapped — planPath(seat, any walkable) is null (component=${size})`,
      )
    }
    if (seatCompCount > 1) {
      console.error(`[walk-grid] FAIL: seats span ${seatCompCount} components (need 1)`)
    }
    if (comps.length !== 1) {
      console.error(`[walk-grid] FAIL: walkable grid has ${comps.length} components (need 1)`)
    }
    process.exit(1)
  }
  const walkGrid = kind.map((k) => (k === WALK_KIND_BLOCKED ? 1 : 0))
  const kindCounts = [0, 0, 0, 0]
  for (const k of kind) kindCounts[k] += 1
  const walkableCells = walkGrid.filter((v) => v === 0).length
  const ts = [
    '// 生成文件：scripts/build-pixel-atlas.mjs --walk-grid（真源 = pixel-office.bg.png + pixel-office.placement.json），勿手改。',
    `export const WALK_GRID_COLS = ${COLS}`,
    `export const WALK_GRID_ROWS = ${ROWS}`,
    `export const WALK_GRID_CELL = ${CELL}`,
    '// 1 = blocked（bg 非地板色：墙区/家具/隔断），0 = 可走（floor/carve/seat）。',
    'export const WALK_GRID: readonly number[] = [',
    ...Array.from({ length: ROWS }, (_, r) =>
      `  ${walkGrid.slice(r * COLS, r * COLS + COLS).join(', ')},`),
    ']',
    '',
    '// 0=floor（bg 纯地板，可作游走目标）/ 1=blocked / 2=carve（出座/连接通道：可通行不可作目标）/ 3=seat（座位 foot 格）。',
    'export const WALK_GRID_KIND: readonly number[] = [',
    ...Array.from({ length: ROWS }, (_, r) =>
      `  ${kind.slice(r * COLS, r * COLS + COLS).join(', ')},`),
    ']',
    '',
    '// 连接通道 carve 格（row * COLS + col，不含地板端点）；纯地板分量已连通时为空。',
    `export const WALK_GRID_CONNECTOR: readonly number[] = [${connectorCells.join(', ')}]`,
    `export const WALK_GRID_CONNECTOR_COST = ${connectorCost}`,
    '',
  ].join('\n')
  const outPath = join(scriptDir, '..', 'src/client/core/pixel/walk-grid.generated.ts')
  if (check) {
    if (!existsSync(outPath)) {
      console.error('[walk-grid][check] FAIL: missing walk-grid.generated.ts (run --walk-grid)')
      process.exit(1)
    }
    if (readFileSync(outPath, 'utf8') !== ts) {
      console.error('[walk-grid][check] FAIL: walk-grid.generated.ts drifted from recomputed grid (run --walk-grid)')
      process.exit(1)
    }
    console.log(
      `[walk-grid][check] OK: ${COLS}x${ROWS} cell=${CELL} walkable=${walkableCells}/${walkGrid.length} ` +
        `components=${comps.length} connectorCost=${connectorCost} (byte-identical)`,
    )
    return
  }
  if (writeIfChanged(outPath, ts)) console.log('[walk-grid] written')
  for (const seat of seatPoints) {
    const carved = carvedBySeat.get(seat.id) ?? { cost: 0, cells: [] }
    const exit = carved.cells.length === 0
      ? '(none)'
      : carved.cells.map(([c, r]) => `(${c},${r})`).join('→')
    const compSize = comps[seatCompOf(seat)]?.length ?? 0
    console.log(`[walk-grid] seat ${seat.id} exit: ${exit} cost=${carved.cost} (component=${compSize})`)
  }
  console.log(
    `[walk-grid] floor=${floorCells}/${kind.length} kind: floor=${kindCounts[WALK_KIND_FLOOR]} ` +
      `blocked=${kindCounts[WALK_KIND_BLOCKED]} carve=${kindCounts[WALK_KIND_CARVE]} ` +
      `seat=${kindCounts[WALK_KIND_SEAT]}`,
  )
  console.log(
    `[walk-grid] ${COLS}x${ROWS} cell=${CELL} walkable=${walkableCells}/${walkGrid.length} ` +
      `components=${comps.length} connectorCost=${connectorCost}`,
  )
}

/** --check 的 bg 部分：目标目录无 bg 时跳过（fixture/纯 atlas 场景）。 */
function checkComposeBg({ paths }) {
  const placementPath = join(scriptDir, 'pixel-office.placement.json')
  const bgPath = join(paths.outDir, 'pixel-office.bg.png')
  if (!existsSync(bgPath)) {
    console.log('[compose-bg][check] skip compose-bg (no bg in target out dir)')
    return
  }
  if (!existsSync(placementPath)) {
    console.error('[compose-bg][check] FAIL: placement missing (run --compose-bg first)')
    process.exit(1)
  }
  const placement = JSON.parse(readFileSync(placementPath, 'utf8'))
  const problems = []
  const { bg, W, H, workerDir } = composeWorkerBg()
  const rebuiltPng = encodePng(bg, W, H)
  if (placement.bgSha256 !== createHash('sha256').update(rebuiltPng).digest('hex') &&
      createHash('sha256').update(readFileSync(bgPath)).digest('hex') !== placement.bgSha256) {
    problems.push('bg drifted from layer composite (re-run --compose-bg)')
  }
  const layerSha = createHash('sha256')
  for (const name of ['地板', '隔断外墙', '机房', 'leader区域', '办公区', '外部摆件', '人物-动物']) {
    layerSha.update(readFileSync(join(workerDir, `${name}.png`)))
  }
  if (placement.layersSha256 !== layerSha.digest('hex')) {
    problems.push('worker layers drifted from placement (re-run --compose-bg)')
  }
  const onDisk = decodePng(readFileSync(bgPath))
  if (onDisk.width !== W || onDisk.height !== H) problems.push('bg size drifted')
  for (let i = 3; i < onDisk.rgba.length; i += 4) {
    if (onDisk.rgba[i] !== 255) { problems.push('bg has transparent pixels'); break }
  }
  if (!Buffer.from(onDisk.rgba.subarray(0, W * H * 4)).equals(bg)) {
    problems.push('bg pixels differ from layer composite')
  }
  const expectedSeatsTs = buildSeatsGeneratedTs(placement)
  const slotsPath = join(scriptDir, '..', 'src/client/core/pixel/scene-office-slots.generated.ts')
  if (!existsSync(slotsPath)) {
    problems.push('missing scene-office-slots.generated.ts')
  } else if (readFileSync(slotsPath, 'utf8') !== expectedSeatsTs) {
    problems.push('scene-office-slots.generated.ts drifted from placement (re-run --compose-bg)')
  }
  if (problems.length > 0) {
    for (const pr of problems) console.error(`[compose-bg][check] FAIL: ${pr}`)
    process.exit(1)
  }
  console.log('[compose-bg][check] OK: layers composite 0-diff / alpha255 / seats-ts consistent')
}

function findAncestorFile(relpath) {
  let dir = scriptDir
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, relpath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`file not found: ${relpath}`)
}

function runCheck({ paths, pipe, args }) {
  const problems = []
  if (pipe.unmapped.length > 0) {
    problems.push(`${pipe.unmapped.length} unmapped component(s): ${pipe.unmapped.map(bboxKey).join('; ')}`)
  }
  const staleKeys = [...pipe.map.keys()].filter((k) => !pipe.comps.some((c) => bboxKey(c) === k))
  if (staleKeys.length > 0) problems.push(`stale map keys (no such component): ${staleKeys.join('; ')}`)
  let outputs = null
  try {
    outputs = buildOutputs(args, pipe)
  } catch (err) {
    problems.push(`rebuild failed: ${err.message}`)
  }
  if (outputs !== null) {
    if (!existsSync(paths.tsPath)) {
      problems.push(`missing generated ts: ${paths.tsPath}`)
    } else if (readFileSync(paths.tsPath, 'utf8') !== outputs.ts) {
      problems.push('atlas-map.generated.ts drifted from recomputed content (rect/pivot/params/sha/version)')
    }
    for (const s of SHEETS) {
      const pngPath = join(paths.outDir, `pixel-office.${s}.png`)
      if (!existsSync(pngPath)) {
        problems.push(`missing atlas png: ${pngPath}`)
        continue
      }
      const disk = decodePng(readFileSync(pngPath))
      const expect = decodePng(outputs.pngBuffers[s])
      if (disk.width !== expect.width || disk.height !== expect.height) {
        problems.push(`sheet ${s} size ${disk.width}x${disk.height} != expected ${expect.width}x${expect.height}`)
      } else if (!Buffer.from(disk.rgba).equals(Buffer.from(expect.rgba))) {
        problems.push(`sheet ${s} pixels drifted from recomputed atlas`)
      }
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`[atlas][check] FAIL: ${p}`)
    process.exit(1)
  }
  console.log(`[atlas][check] OK: sha/params/map/ts/png all consistent (${pipe.comps.length} components, ${pipe.entries.length} entries)`)
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  try {
    runBuild(process.argv.slice(2))
  } catch (err) {
    console.error(`[atlas] ERROR: ${err.stack || err.message}`)
    process.exit(1)
  }
}
