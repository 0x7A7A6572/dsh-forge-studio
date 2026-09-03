/**
 * plugin-notes 源码 watch：监听 src/** 变化，自动重新构建。
 *
 * 用法：pnpm --filter @forge-studio/dsh-plugin-notes run watch   （Ctrl+C 停止）
 *
 * 开发循环：改 src → 存盘 → 本脚本自动 build（约 1s）→ 浏览器 Ctrl+F5 强刷。
 * 3180/3080 的 web app 每次请求都动态读取最新的 lib/client.js，故无需重启服务；
 * host 侧（src/index.ts、service/domain/settings）改动仍需重启服务进程。
 *
 * 注意：删除 src 文件后，lib/types 里的残留 .d.ts 不会被 tsc 清理，
 * 请手动 Remove-Item lib -Recurse -Force 后重跑一次 build。
 */
import { watch } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')
const debounceMs = 120

let timer = null
let building = false
let pending = false

function runBuild() {
  if (building) {
    pending = true
    return
  }
  building = true
  const t0 = Date.now()
  try {
    execFileSync(process.execPath, ['scripts/build.mjs'], {
      cwd: root,
      stdio: 'inherit',
    })
    console.log(`[watch] build ok in ${Date.now() - t0}ms — 强刷页面即可看到变更`)
  } catch {
    console.error('[watch] build FAILED — 修好错误后，下一次保存会自动重试')
  } finally {
    building = false
    if (pending) {
      pending = false
      clearTimeout(timer)
      timer = setTimeout(runBuild, 50)
    }
  }
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(runBuild, debounceMs)
}

// 首跑一次，确保 lib/ 与 src/ 一致
runBuild()

try {
  watch(srcDir, { recursive: true }, (_event, filename) => {
    if (!filename) return
    if (!/\.(ts|tsx|css|json)$/.test(String(filename))) return
    schedule()
  })
  console.log(`[watch] watching ${srcDir} — 保存即自动构建，Ctrl+C 停止`)
} catch (err) {
  console.error('[watch] fs.watch failed（Node <19.1 不支持递归监听）:', err)
  process.exitCode = 1
}
