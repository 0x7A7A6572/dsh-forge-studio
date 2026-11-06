import { describe, expect, it } from 'vitest'
import {
  STUDIO_HEADER_ORDER,
  STUDIO_STAGE_KIND,
  STUDIO_STAGE_TAB_ID,
  STUDIO_STAGE_TITLE,
  shouldCommitSingleEntry,
  studioEntryActivationOf,
  studioOpenTabIn,
  studioTabOpenedIn,
  studioToggleActionOf,
} from '../packages/plugin-agent-studio/src/client/core/stage-entry.ts'

describe('agent studio right-sidebar entry', () => {
  it('disables the header button without a mounted session and toggles otherwise', () => {
    expect(studioToggleActionOf({ mounted: undefined, activeKind: STUDIO_STAGE_KIND }))
      .toBe('disabled')
    expect(studioToggleActionOf({ mounted: 's1', activeKind: STUDIO_STAGE_KIND })).toBe('close')
    expect(studioToggleActionOf({ mounted: 's1', activeKind: 'other' })).toBe('open')
    expect(studioToggleActionOf({ mounted: 's1', activeKind: undefined })).toBe('open')
  })

  it('reports aria-pressed only for our tab in the mounted session', () => {
    const tabs = [
      { sessionId: 's1', kind: STUDIO_STAGE_KIND },
      { sessionId: 's2', kind: STUDIO_STAGE_KIND },
      { sessionId: 's1', kind: 'other' },
    ]
    expect(studioTabOpenedIn(tabs, 's1')).toBe(true)
    expect(studioTabOpenedIn(tabs, 's3')).toBe(false)
    expect(studioTabOpenedIn(tabs, undefined)).toBe(false)
  })

  it('keeps the header order beside the official Team action and a stable page identity', () => {
    expect(STUDIO_HEADER_ORDER).toBe(-19)
    expect(STUDIO_STAGE_TAB_ID).toBe('agent-studio-stage')
    expect(STUDIO_STAGE_KIND).toBe('agentStudioStage')
    expect(STUDIO_STAGE_TITLE).toBe('智能体团队')
  })
})

describe('agent studio entry activation', () => {
  const tabs = [
    { sessionId: 's1', tabId: 'tab-1', kind: STUDIO_STAGE_KIND },
    { sessionId: 's1', tabId: 'tab-2', kind: 'other' },
    { sessionId: 's2', tabId: 'tab-3', kind: STUDIO_STAGE_KIND },
  ]

  it('does nothing without a mounted session', () => {
    expect(studioEntryActivationOf({ mounted: undefined, activeKind: undefined, openTabs: tabs }))
      .toEqual({ action: 'disabled' })
  })

  it('closes our active tab', () => {
    expect(studioEntryActivationOf({
      mounted: 's1',
      activeTabId: 'tab-1',
      activeKind: STUDIO_STAGE_KIND,
      openTabs: tabs,
    })).toEqual({ action: 'close', tabId: 'tab-1' })
  })

  it('focuses the tab opened elsewhere instead of opening a duplicate', () => {
    expect(studioEntryActivationOf({
      mounted: 's1',
      activeTabId: 'tab-2',
      activeKind: 'other',
      openTabs: tabs,
    })).toEqual({ action: 'focus', tabId: 'tab-1' })
  })

  it('opens when the mounted session has no such tab yet', () => {
    expect(studioEntryActivationOf({
      mounted: 's3',
      activeKind: undefined,
      openTabs: tabs,
    })).toEqual({ action: 'open' })
  })

  it('opens when the inventory predates tab ids', () => {
    expect(studioEntryActivationOf({
      mounted: 's1',
      activeKind: 'other',
      openTabs: [{ sessionId: 's1', kind: STUDIO_STAGE_KIND }],
    })).toEqual({ action: 'open' })
  })

  it('finds our tab by mounted session only', () => {
    expect(studioOpenTabIn(tabs, 's2')?.tabId).toBe('tab-3')
    expect(studioOpenTabIn(tabs, 's3')).toBeUndefined()
    expect(studioOpenTabIn(tabs, undefined)).toBeUndefined()
  })
})

describe('agent studio single entry commit', () => {
  it('waits for both slot callbacks before registering the tab type', () => {
    expect(shouldCommitSingleEntry({
      paneReady: false,
      headerReady: false,
      tabTypeReady: false,
    })).toBe(false)
    expect(shouldCommitSingleEntry({
      paneReady: true,
      headerReady: false,
      tabTypeReady: false,
    })).toBe(false)
    expect(shouldCommitSingleEntry({
      paneReady: false,
      headerReady: true,
      tabTypeReady: false,
    })).toBe(false)
  })

  it('commits once both seats are ready and the tab type is still missing', () => {
    expect(shouldCommitSingleEntry({
      paneReady: true,
      headerReady: true,
      tabTypeReady: false,
    })).toBe(true)
  })

  it('never registers the tab type twice', () => {
    expect(shouldCommitSingleEntry({
      paneReady: true,
      headerReady: true,
      tabTypeReady: true,
    })).toBe(false)
  })
})
