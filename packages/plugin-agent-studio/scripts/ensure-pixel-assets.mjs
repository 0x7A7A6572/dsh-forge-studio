/**
 * 构建兜底：atlas PNG 缺失时写占位图，保证 pnpm build 不炸。
 * bg 占位 = 256×224 代码绘制（地板 + 8px 网格 + 墙线），env/chars = 1×1 透明。
 * --check 只校验不写入；STRICT_ASSETS=1 时占位图也视为失败（发布前闸门，bg 按 sha 校验）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { decodePng, encodePng } from './build-pixel-atlas.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')
const assetsDir = join(packageDir, 'src/client/assets')
const SHEETS = ['chars']
const BG_SIZE = { width: 256, height: 224 }

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isPng(path) {
  return existsSync(path) && readFileSync(path).subarray(0, 8).equals(PNG_SIGNATURE)
}

function isPlaceholder(path) {
  try {
    const { width, height } = decodePng(readFileSync(path))
    return width === 1 && height === 1
  } catch {
    return false
  }
}

/** bg 占位：代码绘制的地板 + 8px 网格 + 墙线（256×224，尺寸与真 bg 一致）。 */
function placeholderBg() {
  const W = BG_SIZE.width
  const H = BG_SIZE.height
  const rgba = new Uint8ClampedArray(W * H * 4)
  const wall = [129, 133, 140]
  const floor = [74, 120, 194]
  const line = [97, 143, 214]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const c = y < 114 ? wall : floor
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255
      if (y >= 114 && (x % 8 === 0 || y % 8 === 0)) {
        rgba[o] = line[0]; rgba[o + 1] = line[1]; rgba[o + 2] = line[2]
      }
    }
  }
  return encodePng(rgba, W, H)
}

function placementBgSha() {
  const path = join(scriptDir, 'pixel-office.placement.json')
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8')).bgSha256
}

function placementRaw() {
  const path = join(scriptDir, 'pixel-office.placement.json')
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const strict = process.env.STRICT_ASSETS === '1'
  const placeholder = encodePng(new Uint8ClampedArray(4), 1, 1)
  const problems = []
  const real = []
  const placeholderSheets = []
  for (const sheet of SHEETS) {
    const path = join(assetsDir, `pixel-office.${sheet}.png`)
    if (isPng(path)) {
      if (isPlaceholder(path)) {
        placeholderSheets.push(sheet)
        if (strict) problems.push(`${sheet} is a 1x1 placeholder (STRICT_ASSETS=1)`)
        else console.warn(`[pixel-assets] WARN: ${sheet} is a 1x1 placeholder`)
      } else {
        real.push(sheet)
      }
      continue
    }
    if (checkOnly) {
      problems.push(`missing ${path}`)
      continue
    }
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(path, placeholder)
    placeholderSheets.push(sheet)
    console.warn(`[pixel-assets] WARN: wrote 1x1 placeholder for ${sheet} (source atlas absent)`)
  }
  // bg：真伪用 placement.bgSha256 判定（占位尺寸与真图一致，sha 不匹配即占位）。
  const bgPath = join(assetsDir, 'pixel-office.bg.png')
  const expectedSha = placementBgSha()
  if (isPng(bgPath)) {
    const sha = createHash('sha256').update(readFileSync(bgPath)).digest('hex')
    if (expectedSha !== undefined && sha === expectedSha) {
      real.push('bg')
    } else {
      placeholderSheets.push('bg')
      const why = expectedSha === undefined ? 'placement absent' : 'sha mismatch vs placement'
      if (strict) problems.push(`bg is a placeholder (${why}) (STRICT_ASSETS=1)`)
      else console.warn(`[pixel-assets] WARN: bg is a placeholder (${why})`)
    }
  } else if (checkOnly) {
    problems.push(`missing ${bgPath}`)
  } else {
    mkdirSync(assetsDir, { recursive: true })
    writeFileSync(bgPath, placeholderBg())
    placeholderSheets.push('bg')
    console.warn('[pixel-assets] WARN: wrote code-drawn placeholder bg (source absent)')
    if (strict) problems.push('bg was missing and got a placeholder (STRICT_ASSETS=1)')
  }
  // 工位块区域：真伪用 placement.blocks.*.sha256 判定；占位 = 块尺寸全透明（渲染降级站姿）。
  const workPath = join(assetsDir, 'pixel-office.block-empty.png')
  const workPath2 = join(assetsDir, 'pixel-office.block-work.png')
  const blocks = placementRaw()?.blocks
  const blockFiles = [
    { path: workPath, meta: blocks?.empty, tag: 'block-empty' },
    { path: workPath2, meta: blocks?.work, tag: 'block-work' },
  ]
  for (const bf of blockFiles) {
    if (isPng(bf.path)) {
      const sha = createHash('sha256').update(readFileSync(bf.path)).digest('hex')
      if (bf.meta?.sha256 !== undefined && sha === bf.meta.sha256) {
        real.push(bf.tag)
      } else {
        placeholderSheets.push(bf.tag)
        const why = bf.meta?.sha256 === undefined ? 'placement absent' : 'sha mismatch vs placement'
        if (strict) problems.push(`${bf.tag} is a placeholder (${why}) (STRICT_ASSETS=1)`)
        else console.warn(`[pixel-assets] WARN: ${bf.tag} is a placeholder (${why})`)
      }
    } else if (checkOnly) {
      problems.push(`missing ${bf.path}`)
    } else {
      mkdirSync(assetsDir, { recursive: true })
      const w = bf.meta?.w ?? 1
      const h = bf.meta?.h ?? 1
      writeFileSync(bf.path, encodePng(new Uint8ClampedArray(w * h * 4), w, h))
      placeholderSheets.push(bf.tag)
      console.warn(`[pixel-assets] WARN: wrote transparent placeholder ${bf.tag} (source absent)`)
    }
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`[pixel-assets][check] FAIL: ${p}`)
    process.exit(1)
  }
  const parts = []
  if (real.length > 0) parts.push(`real atlas: ${real.join(', ')}`)
  if (placeholderSheets.length > 0) parts.push(`placeholder: ${placeholderSheets.join(', ')}`)
  console.log(`[pixel-assets] ${parts.length > 0 ? parts.join('; ') : 'no asset files'}`)
}

main()
