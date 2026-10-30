/**
 * plugin-agent-studio 构建脚本：
 * 1. 清空 lib —— 已删除的源码不得留旧产物。
 * 2. tsc —— 产出 lib/types/**（host 与 client 的 .d.ts，rootDir=src）。
 * 3. tsdown —— 出 host 入口 lib/index.js 与闭包工厂产物 lib/client.js。
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

rmSync(join(root, 'lib'), { recursive: true, force: true })

function run(bin, args) {
  execFileSync(bin, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

run('npx', ['tsc', '-p', join(root, 'tsconfig.json')])
run('npx', ['tsdown'])

console.log('[plugin-agent-studio] built lib/index.js + lib/client.js + lib/types')
