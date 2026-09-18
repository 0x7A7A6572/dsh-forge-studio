/**
 * plugin-memory 构建脚本：
 * 1. tsc —— 产出 lib/types/**（host 与 client 的 .d.ts，rootDir=src）
 * 2. tsup —— host 入口 src/index.ts → lib/index.js（esm，外部化 @deepseek-ai/*）
 * 3. vite —— client 入口 src/client/index.ts → closure-factory 产物 lib/client.js
 *    （window.__ModuleLoader__.load({ id, factory })；平台模块表外部化、CSS Modules
 *    与样式注入见仓库根的 scripts/vite.client.mjs）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as tsup } from 'tsup'
import { buildClient as viteBuildClient } from '../../../scripts/vite.client.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ID = pkg.name

// 每次构建先清空 lib：已删除的源码（如 render.ts / template-default.ts）不得留旧产物。
rmSync(join(root, 'lib'), { recursive: true, force: true })

const INJECT_MODULES = pkg.dsh?.client?.inject ?? []

/** 1. 类型声明（tsc emitDeclarationOnly）。 */
function emitTypes() {
  execFileSync('npx', ['tsc', '-p', join(root, 'tsconfig.json')], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

/** 2. host 入口 → lib/index.js。 */
async function buildHost() {
  await tsup({
    entry: { index: join(root, 'src/index.ts') },
    outDir: join(root, 'lib'),
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    clean: false,
    dts: false,
    sourcemap: false,
    external: [/^@deepseek-ai\//],
  })
}

/** 3. client 入口 → lib/client.js（closure-factory 产物）。 */
async function buildClient() {
  await viteBuildClient({ root, id: ID, version: pkg.version, inject: INJECT_MODULES })
}

await emitTypes()
await buildHost()
await buildClient()
console.log(`[plugin-memory] built lib/index.js + lib/client.js + lib/types for ${ID}`)
