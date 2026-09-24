/**
 * Side conversations: ephemeral forks that answer a question beside the main
 * thread without disturbing it.
 *
 * The shape deliberately mirrors the session controller's ordinary `fork` —
 * read the source session, compose the recorded preset, create the child with a
 * seed and `isSeeded` lineage — with three differences that define the feature:
 *
 * 1. The child is `ephemeral`, so no persistence handle is ever acquired and
 *    the side transcript leaves no durable trace.
 * 2. The inherited prefix is the parent's history as it stands, so a question
 *    the thread is still waiting on is readable here. A parent whose final turn
 *    is still open is inherited whole and closed by the platform's own
 *    interrupted-turn closers, because a transcript carrying a dangling tool
 *    call is one no provider accepts.
 * 3. A boundary prompt is injected immediately after creation, demoting the
 *    inherited history to reference-only and steering the agent away from
 *    mutations and sub-agents.
 *
 * The service owns the parent/child relation in memory only. That relation is
 * what lets the UI return to the parent and discard the child, and it must not
 * be read back from storage, because an ephemeral child has none.
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
// Type-only imports augment Context and the projection map. The default
// model is injected; agentPresets remains an optional lookup.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
// The attachment service owns admission and storage for question attachments.
import type {} from '@deepseek-ai/dsh-attachment'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { interruptedTurnClosers, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SIDE_BOUNDARY_MARKER, SIDE_BOUNDARY_PROMPT } from './boundary.ts'
// Imported relatively, exactly as the session controller does: the published
// `./types` subpath is what makes these types public to the Remote surface, but
// the local symbol must stay the declaration the analyzer already owns.
import type {
  SideChatAttachmentRequest,
  SideChatAttachmentValue,
  SideChatCloseRequest,
  SideChatCloseValue,
  SideChatContentBlock,
  SideChatListRequest,
  SideChatListValue,
  SideChatOpenRequest,
  SideChatOpenValue,
  SideChatQueuedItem,
  SideChatSendRequest,
  SideChatSendValue,
  SideChatUploadRequest,
  SideChatUploadValue,
  SideChatView,
  SideChatMessage,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sideChat: SideChatService
  }
}

/** Why a side conversation could not be opened. */
export type SideChatFailure =
  /** The parent has recorded nothing yet, so there is nothing to inherit. */
  | 'parent-turn-unavailable'
  /** The parent session does not exist or cannot be observed. */
  | 'parent-not-found'
  /** The parent already has an open side conversation. */
  | 'already-open'
  /** Composition of the parent's preset failed. */
  | 'composition-failed'

/** One open side conversation. */
export interface SideChat {
  /** The ephemeral child session. */
  readonly sessionId: SessionId
  /** The session this side conversation belongs to. */
  readonly parentSessionId: SessionId
  /** The live child agent. */
  readonly agent: Agent
}

/** A failed open, carrying the parent it was attempted for. */
export interface SideChatOpenFailure {
  readonly ok: false
  readonly parentSessionId: SessionId
  readonly reason: SideChatFailure
  readonly message: string
}

/** A successful or failed open. */
export type SideChatOpenResult =
  | { readonly ok: true; readonly sideChat: SideChat }
  | SideChatOpenFailure

/**
 * Read the preset id a session was running under.
 *
 * Mirrors the session controller's own lookup: the projected `agentPreset`
 * value is authoritative, and an absent value means the deployment default.
 * @param observation - the observed parent session.
 * @returns the recorded preset id, if any.
 */
function sidePresetOf(observation: SessionObservation): string | undefined {
  return observation.projections?.values.agentPreset ?? undefined
}

/**
 * Project one live side conversation onto its wire form.
 * @param sideChat - the live conversation.
 * @returns the JSON-safe view the browser receives.
 */
function viewOf(sideChat: SideChat): SideChatView {
  return { sessionId: sideChat.sessionId, parentSessionId: sideChat.parentSessionId }
}

/**
 * Narrow one message's content to the transcript vocabulary the panel renders.
 * Text, images, and files are the only blocks a question or reply carries; a
 * tool exchange inside the inherited prefix is reference data, not a message.
 * @param content - the message's content blocks.
 * @returns the renderable blocks, in message order.
 */
function sideContentOf(content: readonly ContentBlock[]): SideChatContentBlock[] {
  const blocks: SideChatContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text !== '') blocks.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      blocks.push({ type: 'image', attachment: block.attachment })
    } else if (block.type === 'file') {
      blocks.push({ type: 'file', attachment: block.attachment })
    }
  }
  return blocks
}

/** Whether one content list carries a question rather than an injected frame. */
function asksSomething(content: readonly SideChatContentBlock[]): boolean {
  return content.some(block => block.type !== 'text' || block.text.trim() !== '')
}

/**
 * Project admitted wire blocks onto the message content the child stores.
 * @param content - the question's admitted blocks.
 * @returns the same blocks as session-stored content.
 */
function requestedContent(content: readonly SideChatContentBlock[]): ContentBlock[] {
  return content.map(block => block.type === 'text'
    ? { type: 'text' as const, text: block.text }
    : block.type === 'image'
      ? { type: 'image' as const, attachment: block.attachment }
      : { type: 'file' as const, attachment: block.attachment })
}

/** Whether one inherited message is the injected boundary rather than a question. */
function isBoundary(content: readonly SideChatContentBlock[]): boolean {
  const first = content[0]
  return first?.type === 'text' && first.text.startsWith(SIDE_BOUNDARY_MARKER)
}

/**
 * Read a child's admitted-but-undelivered questions as queue rows.
 *
 * The rows mirror the session controller's own inbox projection, so the shared
 * queue dock renders a waiting side question exactly like a waiting main turn.
 * The boundary prompt rides the same next-step inbox and is filtered out: it is
 * an internal frame, never something the reader asked.
 * @param agent - the live child agent.
 * @returns the pending questions, queued turns before steering deliveries.
 */
function queuedItemsOf(agent: Agent): SideChatQueuedItem[] {
  const rows: SideChatQueuedItem[] = []
  const push = (placement: 'queued' | 'steering', message: UserMessage): void => {
    const content = sideContentOf(message.content)
    if (!asksSomething(content) || isBoundary(content)) return
    rows.push({ id: message.id, placement, message: { id: message.id, content } })
  }
  for (const message of agent.inbox.nextTurn) push('queued', message)
  for (const message of agent.inbox.nextStep) {
    // A non-user next-step frame is plugin context (system reminders and the
    // like), which this panel never presents as a waiting question.
    if (message.source.kind === 'user') push('steering', message)
  }
  return rows
}

/**
 * Find one image referenced by a child's own messages.
 * @param events - the child's events at its post-seed offset.
 * @param attachmentId - the attachment identity to find.
 * @returns the durable reference, when the conversation references that image.
 */
function referencedImageIn(events: readonly { type: string; data: unknown }[], attachmentId: string): ImageAttachmentRef | undefined {
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const content = sideContentOf(event.type === 'user/message'
      ? (event.data as { content: ContentBlock[] }).content
      : (event.data as { message: { content: ContentBlock[] } }).message.content)
    for (const block of content) {
      if (block.type === 'image' && String(block.attachment.attachmentId) === attachmentId) return block.attachment
    }
  }
  return undefined
}

/**
 * Own ephemeral side conversations for the sessions of one Host.
 *
 * A parent may have at most one live side conversation at a time, so a second
 * open fails with `already-open` rather than silently replacing the first —
 * the same one-at-a-time rule the CLI enforces.
 */
export class SideChatService extends TypertRemoteService {
  static inject = ['agents', 'sessionQuery', 'agentDefaultModel', 'attachments']

  /** Live side conversations, keyed by their own ephemeral session id. */
  private readonly live = new Map<SessionId, SideChat>()
  /** Owner handles, so disposal can tear the child down deterministically. */
  private readonly handles = new Map<SessionId, AgentHandle>()

  private generation = 0
  private readonly opening = new Set<SessionId>()
  private readonly offsets = new Map<SessionId, number>()
  private readonly busy = new Set<SessionId>()
  private readonly failures = new Map<SessionId, string>()

  constructor(ctx: Context) {
    super(ctx, 'sideChat')
    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.busy.delete(agent.session.id)
    })
    ctx.on('agent/error', ({ agent, error }) => {
      if (this.live.has(agent.session.id)) this.failures.set(agent.session.id, String(error))
    })
    // A Host teardown must never leave an orphaned ephemeral agent running.
    ctx.effect(() => () => { void this.closeAll() }, 'sideChat.closeAll()')
  }

  /**
   * Open a side conversation forked from one parent session.
   *
   * The fork inherits the parent's history as a seed and is created without
   * persistence, so a question the parent is still waiting on is readable in the
   * child. On success the boundary prompt has already been injected, so the
   * child is safe to prompt immediately.
   * @param parentSessionId - the session to fork from.
   * @returns the open result, or a typed failure explaining the refusal.
   */
  async openFor(parentSessionId: SessionId): Promise<SideChatOpenResult> {
    if (this.opening.has(parentSessionId)) {
      return this.fail(parentSessionId, 'already-open', 'A side conversation is already opening.')
    }
    this.opening.add(parentSessionId)
    try { return await this.createSideChat(parentSessionId) }
    finally { this.opening.delete(parentSessionId) }
  }

  private async createSideChat(parentSessionId: SessionId): Promise<SideChatOpenResult> {
    const generation = this.generation
    if (this.findByParent(parentSessionId) !== undefined) {
      return this.fail(parentSessionId, 'already-open', 'This session already has an open side conversation.')
    }

    let observed: SessionObservation
    try {
      observed = await this.ctx.sessionQuery.observeSession(parentSessionId)
    } catch (error: unknown) {
      return this.fail(
        parentSessionId,
        'parent-not-found',
        `Side conversation unavailable: the parent session could not be read (${String(error)}).`,
      )
    }

    try {
      const source = observed
      const live = source.events
      // A quiescent parent is inherited up to its last completed turn, the cut
      // the controller's own fork uses. A parent whose final turn is still open
      // — work in flight, a question awaiting an answer, a crashed writer — is
      // inherited whole and closed by the platform's interrupted-turn closers:
      // the child then sees what the thread is doing right now, including the
      // pending question, and its transcript stays one a provider accepts.
      const closers = interruptedTurnClosers(live)
      const boundary = live.findLast(event => event.type === 'turn/end')
      if (boundary === undefined && closers.length === 0) {
        return this.fail(
          parentSessionId,
          'parent-turn-unavailable',
          'Send a message first, then open a side conversation.',
        )
      }

      const seed = closers.length > 0
        ? [...live, ...closers]
        : live.slice(0, boundary === undefined ? 0 : boundary.seq + 1)
      const cut = SessionLogOffset(seed.length)
      const childId = brandString<SessionId>(`session-${randomUUID()}`)

      const presets = this.ctx.get('agentPresets')
      let presetId: string | undefined
      let setup
      try {
        if (presets !== undefined) {
          presetId = (await presets.resolve(sidePresetOf(source))).id
          setup = async (agentCtx: Context) => { await presets.mount(agentCtx, presetId as string) }
        }
      } catch (error: unknown) {
        return this.fail(
          parentSessionId,
          'composition-failed',
          `Side conversation unavailable: the parent's preset could not be composed (${String(error)}).`,
        )
      }

      const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
      let handle: AgentHandle
      try {
        handle = await this.ctx.agents.create({
          sessionId: childId,
          seed,
          inheritedEventCount: cut,
          // The properties that make this a side conversation rather than an
          // ordinary fork: nothing is ever stored.
          ephemeral: true,
          meta: {
            ...(source.header.cwd === undefined ? {} : { cwd: source.header.cwd }),
            parentSession: parentSessionId,
            isSeeded: true,
            ...(presetId === undefined ? {} : { agentPreset: presetId }),
          },
          agentOptions: { provider, model },
          ...(setup === undefined ? {} : { setup }),
        })
      } catch (error: unknown) {
        return this.fail(
          parentSessionId,
          'composition-failed',
          `Failed to open the side conversation: ${String(error)}`,
        )
      }

      if (generation !== this.generation) {
        handle.agent.cancel({ kind: 'disposed' })
        await handle.dispose()
        return this.fail(parentSessionId, 'composition-failed', 'The side conversation was closed while opening.')
      }

      // The boundary must land before any user turn, so inject it directly
      // rather than queueing it: `inject` places the message at the next step
      // without waking a turn of its own.
      handle.agent.inject(createUserMessage({
        content: [{ type: 'text', text: SIDE_BOUNDARY_PROMPT }],
        source: { kind: 'user' },
      }))

      const sideChat: SideChat = { sessionId: childId, parentSessionId, agent: handle.agent }
      this.offsets.set(childId, cut)
      this.live.set(childId, sideChat)
      this.handles.set(childId, handle)
      return { ok: true, sideChat }
    } finally {
      observed[Symbol.dispose]()
    }
  }

  /**
   * Close one side conversation and discard its ephemeral session.
   * @param sessionId - the side conversation's own session id.
   * @returns true when a conversation was open and is now closed.
   */
  async closeFor(sessionId: SessionId): Promise<boolean> {
    const sideChat = this.live.get(sessionId)
    if (sideChat === undefined) return false
    this.live.delete(sessionId)
    this.offsets.delete(sessionId)
    this.busy.delete(sessionId)
    this.failures.delete(sessionId)
    const handle = this.handles.get(sessionId)
    this.handles.delete(sessionId)
    // A running child must be stopped before disposal; disposal alone waits for
    // an in-flight turn rather than aborting it.
    sideChat.agent.cancel({ kind: 'disposed' })
    await handle?.dispose().catch(() => undefined)
    return true
  }

  /**
   * Look up the open side conversation belonging to one parent.
   * @param parentSessionId - the parent session.
   * @returns the open side conversation, if any.
   */
  findByParent(parentSessionId: SessionId): SideChat | undefined {
    for (const sideChat of this.live.values()) {
      if (sideChat.parentSessionId === parentSessionId) return sideChat
    }
    return undefined
  }

  /**
   * Look up one open side conversation by its own session id.
   * @param sessionId - the side conversation's session id.
   * @returns the open side conversation, if any.
   */
  get(sessionId: SessionId): SideChat | undefined {
    return this.live.get(sessionId)
  }

  /**
   * List every open side conversation.
   * @returns the live conversations in insertion order.
   */
  listOpen(): readonly SideChat[] {
    return [...this.live.values()]
  }

  /**
   * Close every side conversation owned by this service.
   *
   * Wired to the plugin's own disposal so a Host teardown never leaves an
   * orphaned ephemeral agent running.
   */
  async closeAll(): Promise<void> {
    this.generation++
    for (const sessionId of [...this.live.keys()]) await this.closeFor(sessionId)
  }

  /**
   * Open a side conversation for the browser.
   *
   * The wire form carries plain strings; the branded session types stop at this
   * boundary so the Remote surface stays lossless JSON.
   * @param request - the parent session to fork from.
   * @returns the child's identity, or a typed refusal.
   */
  @Remote('open')
  async openRemote(request: SideChatOpenRequest): Promise<SideChatOpenValue> {
    const result = await this.openFor(SessionId(request.parentSessionId))
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message }
    return { ok: true, sideChat: viewOf(result.sideChat) }
  }

  /**
   * Close one side conversation and discard its ephemeral session.
   * @param request - the side conversation's own session id.
   * @returns whether an open conversation was removed.
   */
  @Remote('close')
  async closeRemote(request: SideChatCloseRequest): Promise<SideChatCloseValue> {
    return { closed: await this.closeFor(SessionId(request.sessionId)) }
  }

  /**
   * Read the side conversation currently open for one parent.
   * @param request - the parent session.
   * @returns the open conversation, absent when there is none.
   */
  @Remote('list')
  async listRemote(request: SideChatListRequest): Promise<SideChatListValue> {
    const found = this.findByParent(SessionId(request.parentSessionId))
    if (found === undefined) return {}
    const observed = await this.ctx.sessionQuery.observeSession(found.sessionId)
    try {
      const messages: SideChatMessage[] = []
      for (const event of observed.events.slice(this.offsets.get(found.sessionId))) {
        if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
        // The main transcript does not present plugin-authored runtime context
        // as a human bubble. Keep the side transcript on the same surface:
        // only direct human input is a visible user message.
        if (event.type === 'user/message' && event.data.source.kind !== 'user') continue
        const content = sideContentOf(event.type === 'user/message' ? event.data.content : event.data.message.content)
        if (!asksSomething(content) || isBoundary(content)) continue
        messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', content })
      }
      const error = this.failures.get(found.sessionId)
      return { sideChat: viewOf(found), snapshot: {
        messages,
        running: this.busy.has(found.sessionId) || found.agent.status === 'running',
        pending: queuedItemsOf(found.agent),
        ...(error === undefined ? {} : { error }),
      } }
    } finally { observed[Symbol.dispose]() }
  }

  /**
   * Admit a question without blocking the Remote connection on model output.
   *
   * A question is accepted while the child is still replying, exactly as the
   * main composer accepts one: `steer` is delivered at the running turn's next
   * step, and `queue` waits for the next turn. Attachment blocks are the ones
   * `upload` already admitted, so sending persists nothing new.
   * @param request - open child id, question content, and delivery mode.
   * @returns admission or a refusal; the list operation reads the resulting messages.
   */
  @Remote('send')
  sendRemote(request: SideChatSendRequest): SideChatSendValue {
    const id = SessionId(request.sessionId)
    const found = this.live.get(id)
    if (found === undefined) return { ok: false, message: 'The side conversation is closed. Open it again.' }
    if (!asksSomething(request.content)) return { ok: false, message: 'Enter a question.' }
    this.busy.add(id)
    this.failures.delete(id)
    try {
      const message = createUserMessage({ content: requestedContent(request.content), source: { kind: 'user' } })
      if (request.mode === 'steer') found.agent.steer(message)
      else found.agent.followup(message)
      return { ok: true }
    } catch (error: unknown) {
      this.busy.delete(id)
      return { ok: false, message: String(error) }
    }
  }

  /**
   * Admit one attachment before a question references it.
   *
   * Images are validated and normalized, files are stored verbatim, and the
   * returned block is what `send` submits: the same admission the main composer
   * gets from the session controller, against this conversation's own child.
   * @param request - the child id and the attachment bytes.
   * @returns the admitted block, or the refusal to show beside the draft.
   */
  @Remote('upload')
  async uploadRemote(request: SideChatUploadRequest): Promise<SideChatUploadValue> {
    const found = this.live.get(SessionId(request.sessionId))
    if (found === undefined) return { ok: false, message: 'The side conversation is closed. Open it again.' }
    try {
      const part = request.part
      if (part.type === 'file') {
        const attachment: FileAttachmentRef = await this.ctx.attachments.admitEncodedFile({ data: part.data, name: part.name })
        return { ok: true, block: { type: 'file', attachment } }
      }
      const [admitted] = await this.ctx.attachments.admitPromptContent([{
        type: 'image',
        data: part.data,
        mediaType: part.mediaType as ImageAttachmentRef['mediaType'],
        ...(part.name === undefined ? {} : { name: part.name }),
      }])
      if (admitted === undefined || admitted.type !== 'image') {
        return { ok: false, message: 'The image could not be attached.' }
      }
      return { ok: true, block: { type: 'image', attachment: admitted.attachment } }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Read one image this conversation references, for display beside it.
   * @param request - the child id and the attachment to read.
   * @returns the verified bytes, or the refusal to show in its place.
   */
  @Remote('attachment')
  async attachmentRemote(request: SideChatAttachmentRequest): Promise<SideChatAttachmentValue> {
    const found = this.live.get(SessionId(request.sessionId))
    if (found === undefined) return { ok: false, message: 'The side conversation is closed. Open it again.' }
    const observed = await this.ctx.sessionQuery.observeSession(found.sessionId)
    let ref: ImageAttachmentRef | undefined
    try {
      const own = observed.events.slice(this.offsets.get(found.sessionId))
      ref = referencedImageIn(own, request.attachmentId)
    } finally { observed[Symbol.dispose]() }
    if (ref === undefined) return { ok: false, message: 'That image is not part of this side conversation.' }
    try {
      const stored = await this.ctx.attachments.readImage(ref)
      return { ok: true, mediaType: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64') }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private fail(
    parentSessionId: SessionId,
    reason: SideChatFailure,
    message: string,
  ): SideChatOpenFailure {
    return { ok: false, parentSessionId, reason, message }
  }
}

export default SideChatService
