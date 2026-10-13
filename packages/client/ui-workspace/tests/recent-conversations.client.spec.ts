// @vitest-environment jsdom
/** Navigation retention through the production Client Loader, Session streams and Conversation assembly. */
import { beforeEach, describe, expect, vi } from 'vitest'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { ClientTestFixtures, TestClient } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ev } from '../../../api/session-controller/tests/event-script.client.ts'
import {
  FOLLOW, err, followScript, frame, history, sessionWorld,
} from '../../../api/session-controller/tests/remote/session.client.ts'
import { Config } from '../src/client/config.ts'
import { RecentConversations } from '../src/client/recent-conversations.ts'
import type { Session } from '../../../api/session-controller/src/client/sessions/session.ts'
import type {} from '../src/client/index.ts'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

const WORKSPACE = '@deepseek-ai/dsh-client-ui-workspace'
const it = createClientTest({ roster: webApp.closure([WORKSPACE, '@deepseek-ai/dsh-client-ui-chat']) })
const sid = (id: string) => SessionId(id)
const isA = ([request]: readonly unknown[]) => (request as SessionFollowRequest).address.kind === 'session'
  && (request as { address: { sessionId: string } }).address.sessionId === 'a'

beforeEach(() => { localStorage.clear() })

function seed(mock: ClientTestFixtures['mock'], ids: readonly string[] = ['a', 'b']): void {
  mock.load(sessionWorld)
  mock.remote.session.list.mockResolvedValue({ ok: true, value: { items: ids.map(id => ({
    sessionId: sid(id), updatedAt: 1, running: false, blank: false, agentAvailable: true,
  })) } })
}

async function open(client: TestClient, id: string): Promise<void> {
  client.ctx.uiWorkspace.openSession(sid(id))
  await vi.waitFor(() => {
    expect(client.ctx.sessions.binding(sid(id))?.session.getSnapshot().openState).toBe('open')
  })
}

async function configure(client: TestClient, limit: number): Promise<void> {
  const entry = [...client.ctx.loader.entries()].find(row => row.options.name === WORKSPACE)!
  await client.ctx.loader.update(entry.id, { config: { recentSessionLimit: limit } })
  await client.ctx.loader.await()
}

describe('recent Conversation references', () => {
  it('releases a cached removed Session even before list reconciliation', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    const reference = client.ctx.sessions.retain(sid('a'), { source: 'gateway' })
    const recent = new RecentConversations(client.ctx.sessions, 3)
    try {
      const binding = await reference.ready
      recent.retain(reference)
      reference.release()
      const resident = binding.session as Session
      resident.handleRemoved()
      await vi.waitFor(() => {
        expect(client.ctx.sessions.retainInfo(sid('a')).getSnapshot().referenceCount).toBe(0)
      })
    } finally {
      reference.release()
      recent.dispose()
    }
  })

  it('does not cache a Session already marked removed', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    const reference = client.ctx.sessions.retain(sid('a'), { source: 'gateway' })
    const recent = new RecentConversations(client.ctx.sessions, 3)
    try {
      const binding = await reference.ready
      const resident = binding.session as Session
      resident.handleRemoved()
      await vi.waitFor(() => { expect(binding.session.getSnapshot().removed).toBe(true) })
      recent.retain(reference)
      expect(client.ctx.sessions.retainInfo(sid('a')).getSnapshot().retainedBy).toEqual({ gateway: 1 })
    } finally {
      reference.release()
      recent.dispose()
    }
  })

  it('validates the configurable default and disabled retention', () => {
    expect(Config({})).toEqual({ recentSessionLimit: 3 })
    expect(Config({ recentSessionLimit: 0 })).toEqual({ recentSessionLimit: 0 })
    for (const recentSessionLimit of [-1, 1.5]) {
      expect(() => Config({ recentSessionLimit })).toThrow()
    }
  })

  it('keeps the Session and assembled Conversation while hidden and receives new messages', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    await open(client, 'a')
    const binding = client.ctx.sessions.binding(sid('a'))!
    const conversation = client.ctx.uiConversation.binding(binding)
    conversation.activate('chat')
    await open(client, 'b')
    expect(client.ctx.sessions.retainInfo(sid('a')).getSnapshot().retainedBy).toEqual({ recentConversation: 1 })
    expect(client.ctx.sessions.retainInfo(sid('b')).getSnapshot().retainedBy).toMatchObject({ mainView: 1 })
    const events = [
      ev.turnStart(SessionSeq(0), 1),
      ev.user(SessionSeq(1), 'arrived while hidden'),
      ev.stepStart(SessionSeq(2), 1),
      ev.toolCall(SessionSeq(3), 1, 'hidden-call', 'read', '{}'),
      ev.toolResult(SessionSeq(4), 1, 'hidden-call', 'tool completed while hidden'),
      ev.assistant(SessionSeq(5), 1, 'answer arrived while hidden'),
      ev.stepEnd(SessionSeq(6), 1),
      ev.turnEnd(SessionSeq(7), 1),
    ]
    for (const event of events) expect(mock.streams.push(FOLLOW, frame(event), isA)).toBe(1)
    await mock.streams.drained(FOLLOW, isA)
    await client.flush()
    await open(client, 'a')
    expect(client.ctx.sessions.binding(sid('a'))).toBe(binding)
    expect(client.ctx.uiConversation.binding(binding)).toBe(conversation)
    expect(binding.eventSource.getSnapshot().entries.map(entry => entry.event)).toEqual(events)
    await vi.waitFor(() => {
      const chat = conversation.target('chat').getSnapshot()!
      const nodes = chat.nodes.values()
      expect(nodes.filter(node => node.kind === 'user')).toHaveLength(1)
      expect(JSON.stringify(nodes)).toContain('tool completed while hidden')
      expect(JSON.stringify(nodes)).toContain('answer arrived while hidden')
    })
    expect(mock.log.streams(FOLLOW).filter(stream => isA(stream.args))).toHaveLength(1)
    const retain = vi.spyOn(client.ctx.sessions, 'retain')
    await open(client, 'a')
    expect(retain).not.toHaveBeenCalled()
    retain.mockRestore()
  }, 60_000)

  it('evicts the least recently displayed hidden Session after three entries', async ({ mock, start }) => {
    seed(mock, ['a', 'b', 'c', 'd', 'e'])
    const client = await start()
    await open(client, 'a')
    const a = client.ctx.sessions.binding(sid('a'))
    for (const id of ['b', 'c', 'd', 'a', 'e']) await open(client, id)
    expect(client.ctx.sessions.binding(sid('a'))).toBe(a)
    expect(client.ctx.sessions.binding(sid('b'))).toBeUndefined()
    for (const id of ['a', 'c', 'd']) {
      expect(client.ctx.sessions.retainInfo(sid(id)).getSnapshot().retainedBy).toEqual({ recentConversation: 1 })
    }
    await open(client, 'b')
    expect(mock.log.streams(FOLLOW).filter(stream =>
      (stream.args[0] as SessionFollowRequest).address.kind === 'session'
      && (stream.args[0] as { address: { sessionId: string } }).address.sessionId === 'b')).toHaveLength(2)
  })

  it('releases cached generations when disabled or the plugin unloads', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    await open(client, 'a')
    await open(client, 'b')
    await configure(client, 0)
    expect(client.ctx.sessions.binding(sid('a'))).toBeUndefined()
    await open(client, 'a')
    const a = client.ctx.sessions.binding(sid('a'))
    await open(client, 'b')
    expect(client.ctx.sessions.binding(sid('a'))).toBeUndefined()
    await open(client, 'a')
    expect(client.ctx.sessions.binding(sid('a'))).not.toBe(a)
    await client.unload(WORKSPACE)
    expect(client.ctx.sessions.retainInfo(sid('a')).getSnapshot().referenceCount).toBe(0)
    expect(client.ctx.sessions.retainInfo(sid('b')).getSnapshot().referenceCount).toBe(0)
  })

  it('shares an in-flight opening through rapid navigation', async ({ mock, start }) => {
    seed(mock)
    const pending = Promise.withResolvers<ReturnType<typeof history>>()
    mock.stream(FOLLOW, followScript(request => request.address.kind === 'session'
      && request.address.sessionId === sid('a') ? pending.promise : history([])))
    const client = await start()
    client.ctx.uiWorkspace.openSession(sid('a'))
    const a = client.ctx.sessions.binding(sid('a'))
    client.ctx.uiWorkspace.openSession(sid('b'))
    client.ctx.uiWorkspace.openSession(sid('a'))
    expect(client.ctx.sessions.binding(sid('a'))).toBe(a)
    pending.resolve(history([]))
    await open(client, 'a')
    expect(mock.log.streams(FOLLOW).filter(stream => isA(stream.args))).toHaveLength(1)
  })

  it('drops archived cached conversations without stopping the displayed Session', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    await open(client, 'a')
    await open(client, 'b')
    mock.streams.push('workspace/follow', { type: 'archived', archivedSessionIds: [sid('a')] })
    await vi.waitFor(() => { expect(client.ctx.sessions.binding(sid('a'))).toBeUndefined() })
    expect(client.ctx.sessions.retainInfo(sid('b')).getSnapshot().retainedBy).toMatchObject({ mainView: 1 })
  })

  it('releases a removed hidden Session and cannot reuse its retired generation', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    await open(client, 'a')
    await open(client, 'b')
    mock.streams.push('$events', { type: 'emit', event: 'api-session/removed', args: [sid('a')] })
    await vi.waitFor(() => { expect(client.ctx.sessions.binding(sid('a'))).toBeUndefined() })
    expect(client.ctx.sessions.retainInfo(sid('a')).getSnapshot().referenceCount).toBe(0)
  })

  it('drops a cached reference when its exact scope is disposed', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    await open(client, 'a')
    const a = client.ctx.sessions.binding(sid('a'))!
    await open(client, 'b')
    await a.ctx.fiber.dispose()
    expect(client.ctx.sessions.retainInfo(sid('a')).getSnapshot().referenceCount).toBe(0)
    await open(client, 'a')
    expect(client.ctx.sessions.binding(sid('a'))).not.toBe(a)
  })

  it('acquires the current generation on reselection after the displayed scope is disposed', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    await open(client, 'a')
    const previous = client.ctx.sessions.binding(sid('a'))!
    await previous.ctx.fiber.dispose()
    const other = client.ctx.sessions.retain(sid('a'), { source: 'recentConversation' })
    try {
      const current = await other.ready
      expect(current).not.toBe(previous)
      await open(client, 'a')
      expect(client.ctx.sessions.retainInfo(sid('a')).getSnapshot().retainedBy).toMatchObject({ mainView: 1 })
      other.release()
      expect(client.ctx.sessions.binding(sid('a'))).toBe(current)
      const retainedBy = client.ctx.sessions.retainInfo(sid('a')).getSnapshot().retainedBy
      expect(retainedBy).toMatchObject({ mainView: 1 })
      expect(retainedBy.recentConversation).toBeUndefined()
      expect(mock.log.streams(FOLLOW).filter(stream => isA(stream.args))).toHaveLength(2)
    } finally {
      other.release()
    }
  })

  it('allows the displayed failed opening to be retried on reselection', async ({ mock, start }) => {
    seed(mock)
    let failed = false
    mock.stream(FOLLOW, followScript((request) => {
      if (request.address.kind === 'session' && request.address.sessionId === sid('a') && !failed) {
        failed = true
        return err(new RemoteError('gateway/internal', 'history unavailable', {}))
      }
      return history([])
    }))
    const client = await start()
    client.ctx.uiWorkspace.openSession(sid('a'))
    await vi.waitFor(() => {
      expect(client.ctx.sessions.binding(sid('a'))?.session.getSnapshot().openState).toBe('error')
    })
    await open(client, 'a')
    expect(mock.log.streams(FOLLOW).filter(stream => isA(stream.args))).toHaveLength(2)
  })

  it('reopens cached streams after reconnect without replacing their Session objects', async ({ mock, start }) => {
    seed(mock)
    const client = await start()
    await open(client, 'a')
    const a = client.ctx.sessions.binding(sid('a'))
    await open(client, 'b')
    client.connection.reconnect()
    mock.streams.fail(FOLLOW, new RemoteStreamCarrierError('offline'))
    await vi.waitFor(() => { expect(mock.log.streams(FOLLOW).filter(stream => isA(stream.args))).toHaveLength(2) }, { timeout: 5_000 })
    await open(client, 'a')
    expect(client.ctx.sessions.binding(sid('a'))).toBe(a)
    expect(mock.log.streams(FOLLOW).filter(stream => isA(stream.args))).toHaveLength(2)
  }, 10_000)
})
