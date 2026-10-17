/**
 * Side conversations: ephemeral, boundary-marked forks of a parent session.
 *
 * These tests pin the observable contract of `/side`: the child inherits the
 * parent's completed history, is never persisted, refuses a second open for the
 * same parent, and leaves the parent untouched when it is discarded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SideChatService, { type SideChatContentBlock } from '@deepseek-ai/dsh-side-chat'
import { SIDE_BOUNDARY_MARKER, withSideDeveloperInstructions, SIDE_DEVELOPER_INSTRUCTIONS } from '@deepseek-ai/dsh-side-chat/boundary'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const dirs: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  // Dispose persistence writers before removing their roots, including on a
  // failed assertion. Windows refuses deletion while a writer is still live.
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

/** Concrete point-read query: this suite never exercises search. */
class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

/** Question content carrying one text block, as the wire contract carries it. */
const ask = (text: string): SideChatContentBlock[] => [{ type: 'text', text }]

/** Resolve when one agent finishes its current turn. */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

async function makeContext(
  script: ConstructorParameters<typeof MockAdapter>[0] = [textResponse('side answer')],
): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-side-chat-'))
  dirs.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(JsonlSessionPersistence, { root })
  // Question attachments are stored by the same provider the web composition
  // mounts; the side chat only asks the service to admit them.
  await ctx.plugin(LocalAttachmentStore, { dshHome: root })
  // Side conversations observe a session and read its events; the query engine
  // supplies those point reads. It is a Service, so it is constructed directly
  // (the same way the session-controller suite installs its read services).
  if (ctx.get('sessionQuery') === undefined) new TestSessionQuery(ctx)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(SideChatService)
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  return ctx
}

/** Create a parent session that has completed exactly one turn. */
async function makeStartedParent(ctx: Context, id: string, cwd?: string): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    meta: cwd === undefined ? {} : { cwd },
    agentOptions: { model: 'mock' },
  })
  handle.agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'start the parent task' }],
    source: { kind: 'user' },
  }))
  await waitForIdle(ctx, handle.agent)
  return handle.agent
}

/** Name of the gate tool the send-while-busy scenarios block on. */
const GATE_TOOL = 'wait_for_gate'

/** One gate the scenario opens to let a blocked tool call finish. */
interface GateTool {
  /** Release every blocked call. */
  open(): void
}

/**
 * Register a tool whose call blocks until {@link GateTool.open}, so a turn stays
 * running for as long as the scenario needs while remaining completable.
 * @param ctx - the scenario context with the tool runtime mounted.
 * @returns the gate the scenario opens to let the call finish.
 */
function installGateTool(ctx: Context): GateTool {
  const gate = Promise.withResolvers<undefined>()
  ctx.tools.register(defineContentToolFixture({
    name: GATE_TOOL,
    description: 'block until the scenario opens the gate',
    parameters: {},
    async execute(_args, exec) {
      await Promise.race([
        gate.promise,
        new Promise<void>((_resolve, reject) => {
          if (exec.signal.aborted) { reject(new Error('aborted')); return }
          exec.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        }),
      ])
      return [{ type: 'text', text: 'gate opened' }]
    },
  }))
  return { open: () => { gate.resolve(undefined) } }
}

describe('side conversations', () => {
  it('forks the parent history into an ephemeral child that is never stored', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-a')
    const parentEvents = parent.session.snapshotEvents()

    const result = await ctx.sideChat.openFor(SessionId('parent-a'))
    if (!result.ok) throw new Error(`open failed: ${result.reason} — ${result.message}`)
    expect(result.ok).toBe(true)

    const { sideChat } = result
    expect(sideChat.parentSessionId).toBe('parent-a')
    // The child inherited the parent's completed prefix.
    expect(sideChat.agent.session.snapshotEvents().length).toBeGreaterThanOrEqual(parentEvents.length)
    expect(sideChat.agent.session.header.isSeeded).toBe(true)

    // ...and it left no durable trace.
    await expect(ctx.sessionPersistence.open(sideChat.sessionId, 'read')).rejects.toThrow()

    await ctx.sideChat.closeAll()
  })

  it('injects the boundary prompt so inherited history is reference-only', async () => {
    const ctx = await makeContext()
    await makeStartedParent(ctx, 'parent-b')

    const result = await ctx.sideChat.openFor(SessionId('parent-b'))
    if (!result.ok) throw new Error('expected the side conversation to open')

    const events = result.sideChat.agent.session.snapshotEvents()
    const injected = events.filter(event => event.type === 'agent/inbox/spliced')
    expect(injected.length).toBeGreaterThan(0)
    expect(JSON.stringify(injected)).toContain(SIDE_BOUNDARY_MARKER)

    await ctx.sideChat.closeAll()
  })

  it('refuses a second side conversation for the same parent', async () => {
    const ctx = await makeContext()
    await makeStartedParent(ctx, 'parent-c')

    const first = await ctx.sideChat.openFor(SessionId('parent-c'))
    expect(first.ok).toBe(true)

    const second = await ctx.sideChat.openFor(SessionId('parent-c'))
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('expected the second open to be refused')
    expect(second.reason).toBe('already-open')

    await ctx.sideChat.closeAll()
  })

  it('refuses a parent that has not completed a turn', async () => {
    const ctx = await makeContext()
    await ctx.agents.create({ sessionId: SessionId('parent-fresh'), agentOptions: { model: 'mock' } })

    const result = await ctx.sideChat.openFor(SessionId('parent-fresh'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the open to be refused')
    expect(result.reason).toBe('parent-turn-unavailable')
  })

  it('discards the child and releases the slot on close', async () => {
    const ctx = await makeContext()
    await makeStartedParent(ctx, 'parent-d')

    const result = await ctx.sideChat.openFor(SessionId('parent-d'))
    if (!result.ok) throw new Error('expected the side conversation to open')
    const childId = result.sideChat.sessionId

    expect(await ctx.sideChat.closeFor(childId)).toBe(true)
    expect(ctx.sideChat.get(childId)).toBeUndefined()
    expect(ctx.sideChat.findByParent(SessionId('parent-d'))).toBeUndefined()
    expect(ctx.sessions.get(childId)).toBeUndefined()
    // The parent survives its side conversation.
    expect(ctx.sessions.get(SessionId('parent-d'))).toBeDefined()

    await ctx.sideChat.closeAll()
  })

  it('leaves the parent session unchanged across a side conversation', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-e')
    const before = parent.session.snapshotEvents()

    const result = await ctx.sideChat.openFor(SessionId('parent-e'))
    if (!result.ok) throw new Error('expected the side conversation to open')
    await ctx.sideChat.closeAll()

    expect(parent.session.snapshotEvents()).toEqual(before)
  })

  it('exposes the same behavior through its JSON-only Remote surface', async () => {
    const ctx = await makeContext()
    await makeStartedParent(ctx, 'parent-remote')

    // Open crosses the wire with plain strings and returns a JSON-safe view.
    const opened = await ctx.sideChat.openRemote({ parentSessionId: 'parent-remote' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) throw new Error(`remote open failed: ${opened.reason}`)
    expect(opened.sideChat.parentSessionId).toBe('parent-remote')
    // The view is lossless JSON: no live agent or branded value leaks out.
    expect(JSON.parse(JSON.stringify(opened.sideChat))).toEqual(opened.sideChat)
    expect(Object.keys(opened.sideChat).sort()).toEqual(['parentSessionId', 'sessionId'])

    // List reports the open conversation for that parent.
    const listed = await ctx.sideChat.listRemote({ parentSessionId: 'parent-remote' })
    expect(listed.sideChat).toEqual(opened.sideChat)

    // Close removes it, and a second close is a no-op rather than an error.
    expect(await ctx.sideChat.closeRemote({ sessionId: opened.sideChat.sessionId }))
      .toEqual({ closed: true })
    expect(await ctx.sideChat.closeRemote({ sessionId: opened.sideChat.sessionId }))
      .toEqual({ closed: false })
    expect(await ctx.sideChat.listRemote({ parentSessionId: 'parent-remote' })).toEqual({})
  })

  it('reports a refusal through the Remote surface without throwing', async () => {
    const ctx = await makeContext()
    await ctx.agents.create({ sessionId: SessionId('parent-remote-fresh'), agentOptions: { model: 'mock' } })

    // A refusal is data on the wire, so the browser can render it as a message.
    const refused = await ctx.sideChat.openRemote({ parentSessionId: 'parent-remote-fresh' })
    expect(refused).toMatchObject({ ok: false, reason: 'parent-turn-unavailable' })
  })
})


describe('side chat question delivery', () => {
  it('delivers the question, returns only child exchanges, and never writes the child', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-send')
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    const child = opened.sideChat
    const idle = waitForIdle(ctx, child.agent)
    expect(ctx.sideChat.sendRemote({ sessionId: child.sessionId, content: ask('Explain this task') })).toEqual({ ok: true })
    await idle
    const listed = await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })
    expect(listed.snapshot).toEqual({ running: false, pending: [], messages: [
      { role: 'user', content: ask('Explain this task') },
      { role: 'assistant', content: ask('side answer') },
    ] })
    await expect(ctx.sessionPersistence.open(child.sessionId, 'read')).rejects.toThrow()
    await ctx.sideChat.closeFor(child.sessionId)
    expect(ctx.sideChat.sendRemote({ sessionId: child.sessionId, content: ask('closed') }).ok).toBe(false)
  })

  it('reserves the parent before async creation, rejecting simultaneous opens', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-race')
    const outcomes = await Promise.all([ctx.sideChat.openFor(parent.session.id), ctx.sideChat.openFor(parent.session.id)])
    expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(1)
    expect(ctx.sideChat.listOpen()).toHaveLength(1)
    await ctx.sideChat.closeAll()
  })
})

it('does not leave a child when teardown races with opening', async () => {
  const ctx = await makeContext()
  const parent = await makeStartedParent(ctx, 'parent-opening-close')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const observe = ctx.sessionQuery.observeSession.bind(ctx.sessionQuery)
  vi.spyOn(ctx.sessionQuery, 'observeSession').mockImplementationOnce(async (id) => {
    await gate
    return observe(id)
  })
  const opening = ctx.sideChat.openFor(parent.session.id)
  await ctx.sideChat.closeAll()
  release()
  expect((await opening).ok).toBe(false)
  expect(ctx.sideChat.listOpen()).toEqual([])
})

describe('side conversations opened while the parent waits', () => {
  it('inherits the question the parent is still waiting on, closed for the provider', async () => {
    const ctx = await makeContext([
      toolCallResponse('call-question', 'ask_question', { question: 'Which database should this use?' }),
      textResponse('side answer'),
    ])
    // A tool that settles only on abort stands in for a question the reader has
    // not answered yet: the turn stays open, with a call that has no result.
    ctx.tools.register(defineContentToolFixture({
      name: 'ask_question',
      description: 'ask the reader a question',
      parameters: { question: { type: 'string', required: true } },
      async execute(_args, exec) {
        await new Promise<void>((_resolve, reject) => {
          if (exec.signal.aborted) { reject(new Error('aborted')); return }
          exec.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
        return []
      },
    }))
    const handle = await ctx.agents.create({
      sessionId: SessionId('parent-waiting'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'start the parent task' }],
      source: { kind: 'user' },
    }))
    await vi.waitFor(() => {
      const recorded = handle.agent.session.snapshotEvents().map(event => event.type)
      expect(recorded).toContain('tool/call')
    }, { timeout: 5_000 })

    // The parent has no completed turn; the side conversation must still open.
    const opened = await ctx.sideChat.openFor(handle.agent.session.id)
    if (!opened.ok) throw new Error(`open failed: ${opened.reason} — ${opened.message}`)
    const { sideChat } = opened

    const inherited = sideChat.agent.session.snapshotEvents(
      SessionLogOffset(0),
      sideChat.agent.session.inheritedEventCount,
    )
    // The pending question is readable, and its dangling call is closed.
    expect(JSON.stringify(inherited)).toContain('Which database should this use?')
    expect(inherited.some(event => event.type === 'tool/result')).toBe(true)
    expect(inherited.at(-1)?.type).toBe('turn/end')
    // Every inherited call has a result, so the child's transcript is one a
    // provider accepts.
    const messages = sideChat.agent.session.deriveMessages()
    const blocks = messages.flatMap(message => message.content)
    const callIds = blocks.flatMap(block => block.type === 'tool-call' ? [block.id] : [])
    const resultIds = messages.flatMap(message => message.role === 'tool' ? [message.toolCallId] : [])
    expect(callIds).toHaveLength(1)
    expect(resultIds).toEqual(callIds)
    // The closers are inherited history, never the child's own exchange.
    expect((await ctx.sideChat.listRemote({ parentSessionId: handle.agent.session.id })).snapshot)
      .toEqual({ running: false, pending: [], messages: [] })

    // The child answers on top of that prefix: the reader can dig into the
    // question here while the parent thread is still waiting on it.
    const childIdle = waitForIdle(ctx, sideChat.agent)
    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: ask('Explain that question.') })).toEqual({ ok: true })
    await childIdle
    expect((await ctx.sideChat.listRemote({ parentSessionId: handle.agent.session.id })).snapshot)
      .toEqual({ running: false, pending: [], messages: [
        { role: 'user', content: ask('Explain that question.') },
        { role: 'assistant', content: ask('side answer') },
      ] })

    const idle = waitForIdle(ctx, handle.agent)
    handle.agent.cancel({ kind: 'user' })
    await idle
    await ctx.sideChat.closeAll()
  })
})

describe('side chat questions submitted while the child replies', () => {
  it('queues a question behind the running reply, shows it waiting, then runs it', async () => {
    const ctx = await makeContext([
      toolCallResponse('call-gate', GATE_TOOL, {}),
      textResponse('first answer'),
      textResponse('queued answer'),
    ])
    const gate = installGateTool(ctx)
    const parent = await makeStartedParent(ctx, 'parent-queue')
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    const { sideChat } = opened
    // The injected boundary prompt rides the same next-step inbox; it is not a
    // question the reader asked, so it never shows as waiting.
    expect((await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })).snapshot?.pending).toEqual([])

    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: ask('first question') })).toEqual({ ok: true })
    await vi.waitFor(() => {
      const types = sideChat.agent.session.snapshotEvents().map(event => event.type)
      expect(types).toContain('tool/call')
    }, { timeout: 5_000 })

    // The second question is admitted while the reply runs instead of refused,
    // and it is visible while it waits for its turn.
    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: ask('queued question') })).toEqual({ ok: true })
    const waiting = await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })
    expect(waiting.snapshot?.pending.map(row => ({ placement: row.placement, content: row.message.content })))
      .toEqual([{ placement: 'queued', content: ask('queued question') }])
    // The row id is the inbox occurrence the shared queue verb addresses.
    expect(waiting.snapshot?.pending[0]?.id).toBe(sideChat.agent.inbox.nextTurn[0]?.id)

    // The reply ends on its own, and the queued question then runs.
    gate.open()
    await vi.waitFor(async () => {
      const listed = await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })
      expect(listed.snapshot?.messages).toEqual([
        { role: 'user', content: ask('first question') },
        { role: 'assistant', content: ask('first answer') },
        { role: 'user', content: ask('queued question') },
        { role: 'assistant', content: ask('queued answer') },
      ])
      expect(listed.snapshot?.pending).toEqual([])
    }, { timeout: 5_000 })
    await ctx.sideChat.closeAll()
  })

  it('delivers a steer question at the next step of the running turn', async () => {
    const ctx = await makeContext([
      toolCallResponse('call-gate', GATE_TOOL, {}),
      textResponse('steered answer'),
    ])
    const gate = installGateTool(ctx)
    const parent = await makeStartedParent(ctx, 'parent-steer')
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    const { sideChat } = opened

    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: ask('first question') })).toEqual({ ok: true })
    await vi.waitFor(() => {
      const types = sideChat.agent.session.snapshotEvents().map(event => event.type)
      expect(types).toContain('tool/call')
    }, { timeout: 5_000 })

    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: ask('steered question'), mode: 'steer' })).toEqual({ ok: true })
    const waiting = await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })
    expect(waiting.snapshot?.pending.map(row => ({ placement: row.placement, content: row.message.content })))
      .toEqual([{ placement: 'steering', content: ask('steered question') }])

    gate.open()
    await vi.waitFor(async () => {
      const listed = await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })
      expect(listed.snapshot?.messages).toContainEqual({ role: 'user', content: ask('steered question') })
      expect(listed.snapshot?.messages).toContainEqual({ role: 'assistant', content: ask('steered answer') })
      expect(listed.snapshot?.pending).toEqual([])
    }, { timeout: 5_000 })
    await ctx.sideChat.closeAll()
  })
})

describe('side chat question attachments', () => {
  /** The smallest image the attachment service accepts. */
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('admits an image, sends it with the question, and reads it back', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-image')
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    const { sideChat } = opened

    const uploaded = await ctx.sideChat.uploadRemote({
      sessionId: sideChat.sessionId,
      part: { type: 'image', data: PNG_1X1, mediaType: 'image/png', name: 'dot.png' },
    })
    if (!uploaded.ok) throw new Error(uploaded.message)
    expect(uploaded.block.type).toBe('image')
    if (uploaded.block.type !== 'image') throw new Error('expected an image block')

    const idle = waitForIdle(ctx, sideChat.agent)
    expect(ctx.sideChat.sendRemote({
      sessionId: sideChat.sessionId,
      content: [{ type: 'text', text: 'what is this?' }, uploaded.block],
    })).toEqual({ ok: true })
    await idle

    // The transcript carries the admitted blocks in order.
    const listed = await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })
    expect(listed.snapshot?.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'what is this?' }, uploaded.block],
    })
    // The panel reads the bytes back through the conversation's own child.
    const read = await ctx.sideChat.attachmentRemote({
      sessionId: sideChat.sessionId,
      attachmentId: String(uploaded.block.attachment.attachmentId),
    })
    if (!read.ok) throw new Error(read.message)
    expect(read.mediaType).toBe('image/png')
    expect(read.data.length).toBeGreaterThan(0)
    await ctx.sideChat.closeAll()
  })

  it('admits a generic file and refuses a question with nothing in it', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-file')
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    const { sideChat } = opened

    const uploaded = await ctx.sideChat.uploadRemote({
      sessionId: sideChat.sessionId,
      part: { type: 'file', data: Buffer.from('hello').toString('base64'), name: 'notes.txt' },
    })
    if (!uploaded.ok) throw new Error(uploaded.message)
    expect(uploaded.block).toMatchObject({ type: 'file', attachment: { name: 'notes.txt', bytes: 5 } })

    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: [] }))
      .toEqual({ ok: false, message: 'Enter a question.' })
    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: [{ type: 'text', text: '   ' }] }))
      .toEqual({ ok: false, message: 'Enter a question.' })

    // An attachment on its own is a question.
    const idle = waitForIdle(ctx, sideChat.agent)
    expect(ctx.sideChat.sendRemote({ sessionId: sideChat.sessionId, content: [uploaded.block] })).toEqual({ ok: true })
    await idle
    await ctx.sideChat.closeAll()
  })

  it('refuses attachment work for a closed conversation', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-closed-upload')
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    await ctx.sideChat.closeFor(opened.sideChat.sessionId)

    const uploaded = await ctx.sideChat.uploadRemote({
      sessionId: opened.sideChat.sessionId,
      part: { type: 'file', data: Buffer.from('x').toString('base64'), name: 'x.bin' },
    })
    expect(uploaded.ok).toBe(false)
    const read = await ctx.sideChat.attachmentRemote({ sessionId: opened.sideChat.sessionId, attachmentId: 'none' })
    expect(read.ok).toBe(false)
  })
})

describe('side chat failure and projection lifecycle', () => {
  it('reports unavailable parents and failed creation without retaining observations', async () => {
    const ctx = await makeContext()
    await expect(ctx.sideChat.openFor(SessionId('missing'))).resolves.toMatchObject({ ok: false, reason: 'parent-not-found' })
    const parent = await makeStartedParent(ctx, 'parent-fail', '/workspace')
    const create = vi.spyOn(ctx.agents, 'create').mockRejectedValueOnce(new Error('creation failed'))
    const failedCreation = await ctx.sideChat.openFor(parent.session.id)
    expect(failedCreation).toMatchObject({ ok: false, reason: 'composition-failed' })
    if (failedCreation.ok) throw new Error('expected refusal')
    expect(failedCreation.message).toContain('creation failed')
    create.mockRestore()
    const presets = { resolve: vi.fn().mockRejectedValueOnce(new Error('preset failed')), mount: vi.fn() }
    ctx.provide('agentPresets', presets as never)
    const failedPreset = await ctx.sideChat.openFor(parent.session.id)
    expect(failedPreset).toMatchObject({ ok: false, reason: 'composition-failed' })
    if (failedPreset.ok) throw new Error('expected refusal')
    expect(failedPreset.message).toContain('preset failed')
    presets.resolve.mockResolvedValue({ id: 'preset' })
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    expect(presets.mount).toHaveBeenCalled()
    await ctx.sideChat.closeAll()
    await ctx.fiber.dispose()
  })

  it('projects only child questions, reports model failures, and clears failures on admission', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-projection')
    const createAgent = ctx.agents.create.bind(ctx.agents)
    let captured: AgentHandle | undefined
    vi.spyOn(ctx.agents, 'create').mockImplementationOnce(async (options) => {
      captured = await createAgent(options)
      return captured
    })
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    const handle = captured as AgentHandle
    const child = opened.sideChat
    expect(ctx.sideChat.findByParent(SessionId('missing'))).toBeUndefined()
    const file = { attachmentId: 'file', name: 'notes.txt', bytes: 1 } as never
    const image = { attachmentId: 'img', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } as never
    child.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '' }, { type: 'file', attachment: file }, { type: 'image', attachment: image }] }), { surfaceOp: 'append' })
    child.agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: ask('  ') }), { surfaceOp: 'append' })
    child.agent.inject(createUserMessage({ source: { kind: 'user' }, content: ask('  ') }))
    child.agent.inject(createUserMessage({ source: { kind: 'system-prompt' }, content: ask('internal') }))
    child.agent.session.append('user/message', createUserMessage({ source: { kind: 'system-prompt' }, content: ask('internal') }), { surfaceOp: 'append' })
    child.agent.session.append('assistant/message', { turn: 1, step: 1, message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'image', attachment: image }] }), stream: [] }, { surfaceOp: 'append' })
    ctx.emit('agent/error', { agent: parent, turn: 1, step: 1, error: new Error('parent only') })
    ctx.emit('agent/error', { agent: child.agent, turn: 1, step: 1, error: new Error('model failed') })
    const listed = await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })
    expect(listed.snapshot?.error).toContain('model failed')
    expect(listed.snapshot?.messages).toEqual([{ role: 'user', content: [{ type: 'file', attachment: file }, { type: 'image', attachment: image }] }, { role: 'assistant', content: [{ type: 'image', attachment: image }] }])
    expect((await ctx.sideChat.attachmentRemote({ sessionId: child.sessionId, attachmentId: 'absent' })).ok).toBe(false)
    const read = vi.spyOn(ctx.attachments, 'readImage').mockRejectedValueOnce(new Error('missing bytes')).mockRejectedValueOnce('plain refusal')
    expect(await ctx.sideChat.attachmentRemote({ sessionId: child.sessionId, attachmentId: 'img' })).toEqual({ ok: false, message: 'missing bytes' })
    expect(await ctx.sideChat.attachmentRemote({ sessionId: child.sessionId, attachmentId: 'img' })).toEqual({ ok: false, message: 'plain refusal' })
    expect((await ctx.sideChat.attachmentRemote({ sessionId: child.sessionId, attachmentId: 'absent' })).ok).toBe(false)
    read.mockRestore()
    const followup = vi.spyOn(child.agent, 'followup').mockImplementationOnce(() => { throw new Error('admission failed') })
    expect(ctx.sideChat.sendRemote({ sessionId: child.sessionId, content: ask('question') })).toEqual({ ok: false, message: 'Error: admission failed' })
    expect((await ctx.sideChat.listRemote({ parentSessionId: parent.session.id })).snapshot?.error).toBeUndefined()
    followup.mockRestore()
    const dispose = handle.dispose.bind(handle)
    vi.spyOn(handle, 'dispose').mockImplementationOnce(async () => { await dispose(); throw new Error('disposal failed') })
    expect(await ctx.sideChat.closeFor(child.sessionId)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('refuses malformed image admission and reports attachment failures', async () => {
    const ctx = await makeContext()
    const parent = await makeStartedParent(ctx, 'parent-upload-errors')
    const opened = await ctx.sideChat.openFor(parent.session.id)
    if (!opened.ok) throw new Error(opened.message)
    const sessionId = opened.sideChat.sessionId
    const imagePart = { type: 'image' as const, data: 'bad', mediaType: 'image/png' }
    const admit = vi.spyOn(ctx.attachments, 'admitPromptContent')
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{ type: 'text', text: 'unexpected' }])
      .mockRejectedValueOnce(new Error('invalid')).mockRejectedValueOnce('plain failure')
    expect(await ctx.sideChat.uploadRemote({ sessionId, part: imagePart })).toEqual({ ok: false, message: 'The image could not be attached.' })
    expect((await ctx.sideChat.uploadRemote({ sessionId, part: imagePart })).ok).toBe(false)
    expect(await ctx.sideChat.uploadRemote({ sessionId, part: imagePart })).toEqual({ ok: false, message: 'invalid' })
    expect(await ctx.sideChat.uploadRemote({ sessionId, part: imagePart })).toEqual({ ok: false, message: 'plain failure' })
    admit.mockRestore()
    await ctx.sideChat.closeAll()
    await ctx.fiber.dispose()
  })
})

it('preserves configured developer copy and appends the side policy', () => {
  expect(withSideDeveloperInstructions(undefined)).toBe(SIDE_DEVELOPER_INSTRUCTIONS)
  expect(withSideDeveloperInstructions('  ')).toBe(SIDE_DEVELOPER_INSTRUCTIONS)
  expect(withSideDeveloperInstructions(' original ')).toBe(`original\n\n${SIDE_DEVELOPER_INSTRUCTIONS}`)
})
