import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function openWithSystemApp(path: string): Promise<void> {
  const platform = process.platform
  try {
    if (platform === 'win32') {
      await run('cmd', ['/c', 'start', '', path], { windowsHide: true })
      return
    }
    if (platform === 'darwin') {
      await run('open', [path])
      return
    }
    await run('xdg-open', [path])
  } catch {
    throw new Error('系统没有可打开该附件的应用')
  }
}
