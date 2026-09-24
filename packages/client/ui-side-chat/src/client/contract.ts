/** Navigation parameters and injected faces for the side-chat tab. */

import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionUpdateQueueRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type {
  SideChatContentBlock,
  SideChatDeliveryMode,
  SideChatListValue,
  SideChatUploadPart,
} from '@deepseek-ai/dsh-side-chat/types'

/** One queue mutation, exactly as the session controller's queue verb takes it. */
export type SideChatQueueAction = SessionUpdateQueueRequest['action']

import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /**
     * The ephemeral child this tab shows.
     *
     * Optional on purpose: the header action knows the child before placing the
     * tab, while the guide opens a page type with no parameters at all. A tab
     * without it opens its own conversation on mount.
     */
    'side-chat': { readonly sideChatId?: string }
  }
}

/** The outcome of asking for a side conversation. */
export type SideChatOpenOutcome =
  | { readonly ok: true; readonly sideChatId: string }
  | { readonly ok: false; readonly message: string }

/** Props the tab body needs from its owning plugin. */
export interface SideChatBodyInjected {
  readonly hooks: {
    readonly sideChatState: ObservableSnapshot<Record<string, SideChatListValue & { error?: string }>>
    /**
     * The composer's busy-Enter preference, owned by the conversation plugin.
     *
     * This panel offers the same Queue/Steer gestures as the main composer while
     * the child replies, so it reads that one preference instead of keeping a
     * second copy of it.
     */
    readonly busyEnter: ObservableSnapshot<SideChatDeliveryMode>
  }
  readonly watch: (parent: string) => () => void
  readonly send: (child: string, content: readonly SideChatContentBlock[], mode: SideChatDeliveryMode) => Promise<void>
  /**
   * Admit one attachment for the next question.
   *
   * The child is ephemeral, so the panel attaches through its own conversation
   * rather than the session-scoped upload service.
   * @param child - the side conversation's own session id.
   * @param part - the attachment bytes and display name.
   * @returns the admitted block the question submits.
   */
  readonly upload: (child: string, part: SideChatUploadPart) => Promise<SideChatContentBlock>
  /**
   * Apply one queue mutation.
   *
   * Waiting questions use the session controller's own queue verb — the one the
   * main composer mutates through — addressed at this conversation's child.
   * @param child - the side conversation's own session id.
   * @param itemId - the waiting row's inbox identity.
   * @param action - the requested mutation.
   */
  readonly updateQueue: (child: string, itemId: MessageId, action: SideChatQueueAction) => Promise<void>
  /**
   * Resolve one image this conversation references into a displayable URL.
   * @param child - the side conversation's own session id.
   * @param attachment - the durable image reference read from a message block.
   * @returns a data URL carrying the verified bytes.
   */
  readonly imageUrl: (child: string, attachment: ImageAttachmentRef) => Promise<string>
  /** The shared queue strip's copy, owned by the conversation plugin. */
  readonly queueT: TranslateNS<'conversation'>
  /**
   * Stop the reply currently running in one open side conversation.
   *
   * The child keeps its transcript and stays open, so the reader can ask a
   * follow-up; only closing the tab discards it.
   * @param child - the side conversation's own session id.
   * @returns whether the Host admitted the cancellation.
   */
  readonly stop: (child: string) => Promise<boolean>
  /** The parent session this tab was opened from. */
  readonly sessionId: string
  /**
   * Open (or reveal) the side conversation for one parent.
   *
   * Owned by the plugin so the Host call and the tab placement stay in one
   * place; the body only renders the result.
   * @param parentSessionId - the session to fork from.
   * @returns the child identity, or the refusal to show.
   */
  readonly openSideChat: (parentSessionId: string) => Promise<SideChatOpenOutcome>
}

/** Props the header action needs from its owning plugin. */
export interface SideChatOpenActionInjected {
  /** The session the action is offered on. */
  readonly parentSessionId: string
  /** Open (or reveal) the side conversation and place its tab. */
  readonly openSideChat: (parentSessionId: string) => Promise<SideChatOpenOutcome>
}
