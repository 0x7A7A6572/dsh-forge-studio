/**
 * 价表联网抓取的截断兜底：宿主按 maxBodyChars 砍 body 后仍要能拿到全量目录。
 * 直连只服务目录页；汇率页保持整包失败，不缩放金额。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchJson,
  fetchJsonDirect,
} from '../packages/plugin-usage-billing/src/pricing/fetch.ts'
import type { PricingFetchDeps } from '../packages/plugin-usage-billing/src/pricing/fetch.ts'

type HostFetch = PricingFetchDeps['web']['fetch']

const MODELS_DEV = 'https://models.dev/api.json'
const FX = 'https://open.er-api.com/v6/latest/USD'

function depsOf(hostFetch: HostFetch): PricingFetchDeps {
  return { web: { fetch: hostFetch }, snapshots: {} as never, now: () => 0 }
}

function hostBody(content: string, truncated = false) {
  return { url: MODELS_DEV, statusCode: 200, body: { kind: 'text', content }, truncated }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('目录页的直连兜底', () => {
  it('宿主截断时直连取回全量目录', async () => {
    const payload = JSON.stringify({ openai: { models: { 'gpt-x': { cost: { input: 1, output: 2 } } } } })
    const direct = vi.fn(async () => new Response(payload, { status: 200 }))
    vi.stubGlobal('fetch', direct)

    const out = await fetchJson(depsOf(async () => hostBody('{"openai":{"models":{', true)), MODELS_DEV, true)

    expect(out.partial).toBe(false)
    expect(out.json).toEqual(JSON.parse(payload))
    expect(direct).toHaveBeenCalledTimes(1)
  })

  it('宿主抓取完整时不触发直连', async () => {
    const direct = vi.fn()
    vi.stubGlobal('fetch', direct)

    const out = await fetchJson(depsOf(async () => hostBody('{"a":1}')), MODELS_DEV)

    expect(out).toEqual({ json: { a: 1 }, partial: false })
    expect(direct).not.toHaveBeenCalled()
  })

  it('宿主抛错时同样直连兜底', async () => {
    const payload = JSON.stringify({ p: { models: { m: { cost: { input: 2, output: 3 } } } } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload, { status: 200 })))

    const out = await fetchJson(depsOf(async () => { throw new Error('WEB_FETCH_TOO_LARGE') }), MODELS_DEV, true)

    expect(out.partial).toBe(false)
    expect(out.json).toEqual(JSON.parse(payload))
  })

  it('直连也失败时回落到宿主的原始错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))

    await expect(fetchJson(depsOf(async () => { throw new Error('WEB_FETCH_TOO_LARGE') }), MODELS_DEV, true))
      .rejects.toThrow('WEB_FETCH_TOO_LARGE')
  })

  it('截断且直连失败时只合并前缀，标记 partial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const content = '{"alpha":{"models":{"m":{"cost":{"input":1,"output":2}}}},"beta":{"models":{"n":{"cost":{"input":3,"output":4}}}},"gamma":'

    const out = await fetchJson(depsOf(async () => hostBody(content, true)), MODELS_DEV, true)

    expect(out.partial).toBe(true)
    expect(out.json).toEqual(JSON.parse(content.slice(0, content.lastIndexOf(',', content.length - 2)) + '}'))
  })
})

describe('汇率页不兜底', () => {
  it('宿主截断直接失败，不触发直连', async () => {
    const direct = vi.fn()
    vi.stubGlobal('fetch', direct)

    await expect(fetchJson(depsOf(async () => hostBody('{"rates":', true)), FX))
      .rejects.toThrow('响应被截断')
    expect(direct).not.toHaveBeenCalled()
  })
})

describe('直连读取上限', () => {
  it('超过字节上限时中断', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"a":1234567890}', { status: 200 })))

    await expect(fetchJsonDirect(MODELS_DEV, 8)).rejects.toThrow('字节上限')
  })
})
