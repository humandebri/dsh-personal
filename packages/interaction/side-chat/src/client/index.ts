/**
 * Browser-side side-chat client.
 *
 * The browser never forks anything itself: it asks the Host service over the
 * Remote surface and keeps the returned ids. This service exists so UI plugins
 * depend on one typed seam (`ctx.sideChat`) instead of reaching into the
 * gateway for the `sideChat` namespace.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-side-chat/remote'
import type {
  SideChatContentBlock,
  SideChatDeliveryMode,
  SideChatFailureReason,
  SideChatListValue,
  SideChatUploadPart,
  SideChatView,
} from '../types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser-side side-conversation operations. */
    sideChatClient: SideChatClient
  }
}

/** One attempt to open a side conversation. */
export type SideChatOpenOutcome =
  | { readonly ok: true; readonly sideChat: SideChatView }
  | { readonly ok: false; readonly reason: SideChatFailureReason; readonly message: string }

/** The `sideChat` Remote namespace, as the generated artifact declares it. */
export type SideChatRemote = ClientRemote['sideChat']

/**
 * Browser-side side-conversation operations.
 *
 * Every method returns a plain JSON value: a refusal is data, never a thrown
 * error, because "the parent has no completed turn" is an ordinary outcome the
 * UI renders as a message.
 */
export class SideChatClient extends Service {
  constructor(ctx: Context, private readonly remote: SideChatRemote) {
    super(ctx, 'sideChatClient')
  }

  /**
   * Open a side conversation forked from one parent session.
   * @param parentSessionId - the session to fork from.
   * @returns the child identity, or a typed refusal.
   */
  async open(parentSessionId: string): Promise<SideChatOpenOutcome> {
    try {
      const result = await this.remote.open({ parentSessionId })
      if (!result.ok) {
        return { ok: false, reason: 'composition-failed', message: result.error.message }
      }
      const value = result.value
      return value.ok
        ? { ok: true, sideChat: value.sideChat }
        : { ok: false, reason: value.reason, message: value.message }
    } catch (error: unknown) {
      // A thrown error is a transport fault, not a business refusal; it still
      // reaches the reader as message text rather than as an exception.
      const failure = remoteErrorOf(error)
      return {
        ok: false,
        reason: 'composition-failed',
        message: failure?.message ?? String(error),
      }
    }
  }

  /**
   * Read the Host-owned transcript and lifecycle state for one parent.
   * @param parentSessionId - parent whose child is displayed.
   * @returns the live child snapshot, or an empty value after closure.
   * @throws when the transport cannot read the state.
   */
  async read(parentSessionId: string): Promise<SideChatListValue> {
    const result = await this.remote.list({ parentSessionId })
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  /**
   * Admit a question; replies are read through read().
   * @param sessionId - open child identity.
   * @param content - question blocks in order: text and admitted attachments.
   * @param mode - delivery while the child is replying; absent queues it.
   * @returns completion after admission.
   * @throws when admission fails, so the caller retains its draft.
   */
  async send(sessionId: string, content: readonly SideChatContentBlock[], mode: SideChatDeliveryMode = 'queue'): Promise<void> {
    const result = await this.remote.send({ sessionId, content, mode })
    if (!result.ok) throw new Error(result.error.message)
    if (!result.value.ok) throw new Error(result.value.message)
  }

  /**
   * Admit one attachment before a question references it.
   * @param sessionId - open child identity.
   * @param part - the attachment bytes and display name.
   * @returns the admitted block the question submits.
   * @throws when admission is refused, so the caller keeps its draft attachment.
   */
  async upload(sessionId: string, part: SideChatUploadPart): Promise<SideChatContentBlock> {
    const result = await this.remote.upload({ sessionId, part })
    if (!result.ok) throw new Error(result.error.message)
    if (!result.value.ok) throw new Error(result.value.message)
    return result.value.block
  }

  /**
   * Read one image this conversation references, for display.
   * @param sessionId - open child identity.
   * @param attachmentId - the attachment to read.
   * @returns the verified image bytes and media type.
   * @throws when the Host refuses the read.
   */
  async readAttachment(sessionId: string, attachmentId: string): Promise<{ mediaType: string; data: string }> {
    const result = await this.remote.attachment({ sessionId, attachmentId })
    if (!result.ok) throw new Error(result.error.message)
    if (!result.value.ok) throw new Error(result.value.message)
    return { mediaType: result.value.mediaType, data: result.value.data }
  }

  /**
   * Close one side conversation and discard its ephemeral session.
   * @param sessionId - the side conversation's own session id.
   * @returns whether an open conversation was removed.
   */
  async close(sessionId: string): Promise<boolean> {
    const result = await this.remote.close({ sessionId })
    return result.ok ? result.value.closed : false
  }

  /**
   * Read the side conversation currently open for one parent.
   * @param parentSessionId - the parent session.
   * @returns the open conversation, or undefined.
   */
  async find(parentSessionId: string): Promise<SideChatView | undefined> {
    const result = await this.remote.list({ parentSessionId })
    return result.ok ? result.value.sideChat : undefined
  }
}

export type * from '../types.ts'
/** Required browser transport and generated side-chat methods. */
export const inject = ['remote', 'remote.sideChat']

/**
 * Connect the side-chat client to its generated Remote namespace.
 * @param ctx - browser context with the Remote transport installed.
 */
export function apply(ctx: Context): void {
  new SideChatClient(ctx, ctx.remote.sideChat)
}
