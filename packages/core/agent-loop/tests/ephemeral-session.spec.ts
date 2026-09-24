/**
 * Ephemeral sessions skip persistence acquisition entirely.
 *
 * A side conversation exists precisely so the durable log stays untouched, so
 * these tests pin the two halves of that contract: nothing reaches the backend,
 * and the session behaves as an ordinary live session (announced, replaying its
 * seed, usable) until disposal.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const dirs: string[] = []
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }) })

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ephemeral-'))
  dirs.push(root)
  return root
}

/** Resolve when one agent finishes its current turn. */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

async function makeContext(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('ok')]))
  return ctx
}

describe('ephemeral sessions', () => {
  it('publishes a usable session without ever acquiring persistence', async () => {
    const ctx = await makeContext(await makeRoot())
    const created: string[] = []
    ctx.on('session/created', session => { created.push(session.id) })

    const create = vi.spyOn(ctx.sessionPersistence, 'create')

    const handle = await ctx.agents.create({
      sessionId: SessionId('side-ephemeral-1'),
      agentOptions: { model: 'mock' },
      ephemeral: true,
    })

    // The session is live and announced like any other.
    expect(created).toEqual(['side-ephemeral-1'])
    expect(ctx.sessions.get(SessionId('side-ephemeral-1'))).toBeDefined()

    // But no storage was ever acquired for it, and it is absent from the log.
    expect(create).not.toHaveBeenCalled()
    await expect(ctx.sessionPersistence.open(SessionId('side-ephemeral-1'), 'read')).rejects.toThrow()

    await handle.dispose()
  })

  it('still replays an inherited seed so the side chat sees the parent history', async () => {
    const ctx = await makeContext(await makeRoot())

    const parent = await ctx.agents.create({
      sessionId: SessionId('parent-1'),
      agentOptions: { model: 'mock' },
    })
    parent.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'parent context' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, parent.agent)
    // oxlint-disable-next-line typescript/no-deprecated -- test reads a completed prefix to seed from.
    const seed = parent.agent.session.snapshotEvents()
    expect(seed.length).toBeGreaterThan(0)

    const side = await ctx.agents.create({
      sessionId: SessionId('side-ephemeral-2'),
      agentOptions: { model: 'mock' },
      ephemeral: true,
      seed,
      inheritedEventCount: seed.length as never,
      meta: { parentSession: SessionId('parent-1'), isSeeded: true },
    })

    // The inherited history is present in the side session's own log...
    // oxlint-disable-next-line typescript/no-deprecated -- asserting the replayed prefix.
    expect(side.agent.session.snapshotEvents().length).toBeGreaterThanOrEqual(seed.length)
    // ...while the side session itself never reached the backend.
    await expect(ctx.sessionPersistence.open(SessionId('side-ephemeral-2'), 'read')).rejects.toThrow()

    await side.dispose()
    await parent.dispose()
  })

  it('leaves the parent session unchanged after a side session is created and disposed', async () => {
    const ctx = await makeContext(await makeRoot())

    const parent = await ctx.agents.create({
      sessionId: SessionId('parent-2'),
      agentOptions: { model: 'mock' },
    })
    parent.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'do not disturb' }],
      source: { kind: 'user' },
    }))
    await waitForIdle(ctx, parent.agent)
    // oxlint-disable-next-line typescript/no-deprecated -- test captures the exact prefix.
    const before = parent.agent.session.snapshotEvents()

    const side = await ctx.agents.create({
      sessionId: SessionId('side-ephemeral-3'),
      agentOptions: { model: 'mock' },
      ephemeral: true,
      seed: before,
      inheritedEventCount: before.length as never,
      meta: { parentSession: SessionId('parent-2'), isSeeded: true },
    })
    await side.dispose()

    // oxlint-disable-next-line typescript/no-deprecated -- asserting the parent is untouched.
    expect(parent.agent.session.snapshotEvents()).toEqual(before)
    expect(ctx.sessions.get(SessionId('parent-2'))).toBeDefined()

    await parent.dispose()
  })
})
