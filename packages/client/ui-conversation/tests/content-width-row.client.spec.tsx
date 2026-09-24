// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ContentWidthLock, CONTENT_WIDTH_LOCK_KEY } from '../src/client/content-width-lock.ts'
import { ContentWidthRow } from '../src/client/settings/ContentWidthRow.tsx'
import type { ContentWidthRowProps } from '../src/client/settings/ContentWidthRow.tsx'
import { en } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noSessionStatus() {
  return bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))
}

function mount() {
  const lock = new ContentWidthLock()
  const setContentWidthLocked = vi.fn((next: boolean) => { lock.setLocked(next) })
  const props: ContentWidthRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: emptySessions(),
    useSessionStatus: noSessionStatus(),
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: emptyWorkspaces(),
    useContentWidthLocked: bindSnapshotSelector(lock.locked),
    setContentWidthLocked,
    t: makeTranslate(en),
  }
  render(<ContentWidthRow {...props} />)
  return { lock, setContentWidthLocked }
}

const LOCK_NAME = 'Lock transcript width'

describe('ContentWidthRow', () => {
  it('explains the lock and starts unlocked', () => {
    mount()
    expect(screen.getByText(LOCK_NAME)).toBeDefined()
    expect(screen.getByText(/Hide the drag strips/)).toBeDefined()
    expect(screen.getByRole('switch', { name: LOCK_NAME }).getAttribute('aria-checked')).toBe('false')
  })

  it('turns the lock on, persists it, and follows a change made outside the row', () => {
    const b = mount()
    const control = screen.getByRole('switch', { name: LOCK_NAME })
    fireEvent.click(control)
    expect(b.setContentWidthLocked).toHaveBeenCalledWith(true)
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(localStorage.getItem(CONTENT_WIDTH_LOCK_KEY)).toBe('true')

    // A repeated same-value write is a no-op: the durable write is skipped.
    b.lock.setLocked(true)
    expect(localStorage.getItem(CONTENT_WIDTH_LOCK_KEY)).toBe('true')

    fireEvent.click(control)
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(localStorage.getItem(CONTENT_WIDTH_LOCK_KEY)).toBe('false')

    // The shared lock is the source: a write outside the row reaches the switch.
    act(() => { b.lock.setLocked(true) })
    expect(control.getAttribute('aria-checked')).toBe('true')
  })

  it('reads a persisted lock as the initial state', () => {
    localStorage.setItem(CONTENT_WIDTH_LOCK_KEY, 'true')
    mount()
    expect(screen.getByRole('switch', { name: LOCK_NAME }).getAttribute('aria-checked')).toBe('true')
  })
})
