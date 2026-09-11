/**
 * git 渠道作者过滤：默认只取本人提交（回落仓库 user.email），
 * 显式 author 优先，`*`/`all` 放开全作者。
 */

import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitChannel, readRepoUserEmail, resolveAuthorFilter } from '../src/sources/git.ts'

const exec = promisify(execFile)

async function git(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  await exec('git', ['-C', dir, ...args], { env: { ...process.env, ...env } })
}

async function commit(dir: string, message: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
  // commit.gpgsign=false：避免宿主全局签名配置干扰测试仓库。
  await git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message], env)
}

/** 临时仓库：me 提交 2 条、other 提交 1 条（交错，用于验证过滤与排序）。 */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dlog-git-'))
  await git(dir, ['init', '-q'])
  await git(dir, ['config', 'user.name', 'me'])
  await git(dir, ['config', 'user.email', 'me@example.com'])
  await commit(dir, 'mine 1')
  await commit(dir, 'other 1', {
    GIT_AUTHOR_NAME: 'other',
    GIT_AUTHOR_EMAIL: 'other@example.com',
    GIT_COMMITTER_NAME: 'other',
    GIT_COMMITTER_EMAIL: 'other@example.com',
  })
  await commit(dir, 'mine 2')
  return dir
}

const range = { since: '2000-01-01' } as const

describe('git 渠道：默认仅本人提交', () => {
  it('未传 author 时按仓库 user.email 过滤；* 放开全作者；显式值优先', async () => {
    const dir = await makeRepo()
    try {
      expect(await readRepoUserEmail(dir)).toBe('me@example.com')
      expect(await resolveAuthorFilter(dir)).toBe('me@example.com')

      const mine = await gitChannel.scan({ path: dir, label: 'p', range })
      expect(mine.map((e) => e.title).sort()).toEqual(['mine 1', 'mine 2'])

      const all = await gitChannel.scan({ path: dir, label: 'p', range, author: '*' })
      expect(all).toHaveLength(3)

      const other = await gitChannel.scan({ path: dir, label: 'p', range, author: 'other@example.com' })
      expect(other.map((e) => e.title)).toEqual(['other 1'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolveAuthorFilter：* / all（大小写无关）放开，显式值优先', async () => {
    expect(await resolveAuthorFilter('unused-path', '*')).toBe('')
    expect(await resolveAuthorFilter('unused-path', 'ALL')).toBe('')
    expect(await resolveAuthorFilter('unused-path', '  me@example.com  ')).toBe('me@example.com')
  })

  it('无任何 git 身份配置时读为空串（回落为不过滤，不抛错）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dlog-plain-'))
    const emptyConfig = join(dir, 'empty.gitconfig')
    await writeFile(emptyConfig, '')
    const prevGlobal = process.env.GIT_CONFIG_GLOBAL
    const prevSystem = process.env.GIT_CONFIG_SYSTEM
    // 屏蔽宿主的全局/系统身份配置，验证"读不到身份"时的降级路径。
    process.env.GIT_CONFIG_GLOBAL = emptyConfig
    process.env.GIT_CONFIG_SYSTEM = emptyConfig
    try {
      expect(await readRepoUserEmail(dir)).toBe('')
      expect(await resolveAuthorFilter(dir)).toBe('')
    } finally {
      if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = prevGlobal
      if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM
      else process.env.GIT_CONFIG_SYSTEM = prevSystem
      await rm(dir, { recursive: true, force: true })
    }
  })
})
