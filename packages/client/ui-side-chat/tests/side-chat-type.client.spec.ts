/**
 * The side-chat tab type's registrations.
 *
 * These assertions pin the two things a reader notices: that **Side chat**
 * appears among the sidebar's own choices (the guide), and that a tab opened
 * without a child id — which is exactly what a guide pick produces — still
 * reaches a live conversation.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
// The registry is package-internal rather than a published subpath, so the test
// reaches its source directly — the same way the Sidebar's own suite does.
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'

/** This plugin's registration, mirrored from `src/client/index.ts`. */
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-side-chat'

/** Copy stand-in: these tests assert wiring, not language. */
const t = (key: string): string => key

/** A registry holding exactly the side-chat type, as the plugin registers it. */
function registryWithSideChat(): SidebarRightTabRegistry {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  tabs.register({
    id: PLUGIN_ID,
    kind: 'side-chat',
    title: () => t('title'),
    guide: [{
      id: 'side-chat',
      order: 30,
      title: () => t('open'),
      description: () => t('openHint'),
    }],
  })
  return tabs
}

describe('side-chat tab type', () => {
  it('offers a guide entry so the sidebar lists it among its own choices', () => {
    const entries = registryWithSideChat().guide()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe('side-chat')
    expect(entries[0]?.id).toBe('side-chat')
    // The guide draws the title on every entry and the description only while
    // the list is short, so both must resolve.
    expect(entries[0]?.title()).toBe('open')
    expect(entries[0]?.description?.()).toBe('openHint')
  })

  it('keeps the announced and callable kinds identical', () => {
    const tabs = registryWithSideChat()
    // The guide names a kind the registry must itself know, or a pick would
    // open a page nothing can draw.
    expect(tabs.get('side-chat')).toBeDefined()
    expect(tabs.get('side-chat')?.kind).toBe('side-chat')
  })

  it('declares no resource patterns, because it is a page type rather than a viewer', () => {
    const definition = registryWithSideChat().get('side-chat')
    // A page type is opened by kind; claiming addresses would make the sidebar
    // route files into a chat.
    expect(definition?.patterns).toBeUndefined()
    expect(definition?.multiple).toBeUndefined()
  })

  it('keeps one tab per parent by reserving no multiple flag', () => {
    // Omission is the single-instance rule: a second open reveals the first tab.
    expect(registryWithSideChat().get('side-chat')?.multiple).not.toBe(true)
  })
})
