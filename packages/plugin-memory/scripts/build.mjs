/**
 * plugin-memory 构建脚本：
 * 1. 清空 lib —— 已删除的源码不得留旧产物。
 * 2. tsc —— 产出 lib/types/**（host 与 client 的 .d.ts，rootDir=src）。
 * 3. tsdown —— 按 tsdown.config.ts 出 host 入口 lib/index.js 与闭包工厂产物
 *    lib/client.js（window.__ModuleLoader__.load({ id, factory })）。
 *    平台模块表外部化、CSS Modules 编译与 <style> 注入、动态 import 内联，
 *    都在仓库根 scripts/tsdown.client.mjs 里（移植自官方客户端构建预设）。
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

rmSync(join(root, 'lib'), { recursive: true, force: true })

/** 包根目录下跑一个命令行工具（Windows 下 npx/tsc 是 .cmd，需要 shell）。 */
function run(bin, args) {
  execFileSync(bin, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

run('npx', ['tsc', '-p', join(root, 'tsconfig.json')])
run('npx', ['tsdown'])

console.log('[plugin-memory] built lib/index.js + lib/client.js + lib/types')
