/**
 * Wire contract for the side-chat Remote surface.
 *
 * These types cross the Host/browser boundary, so they carry only lossless
 * JSON: no `Agent`, no `SessionId` brand, no live handles. The browser works
 * with plain ids and reconstructs nothing.
 *
 * Queue rows mirror the session controller's own pending-queue occurrence
 * (`SessionQueuedItem`): the side panel renders them with the same dock the
 * main composer uses, so both sides speak one row shape.
 */

import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'

/** Why a side conversation could not be opened. */
export type SideChatFailureReason =
  /** The parent has recorded nothing yet, so there is nothing to inherit. */
  | 'parent-turn-unavailable'
  /** The parent session does not exist or cannot be observed. */
  | 'parent-not-found'
  /** The parent already has an open side conversation. */
  | 'already-open'
  /** Composition of the parent's preset failed. */
  | 'composition-failed'

/** Open a side conversation forked from one parent session. */
export interface SideChatOpenRequest {
  /** The session to fork from. */
  readonly parentSessionId: string
}

/** One open side conversation, as the browser sees it. */
export interface SideChatView {
  /** The ephemeral child session id. */
  readonly sessionId: string
  /** The session this side conversation belongs to. */
  readonly parentSessionId: string
}

/** One admitted content block of a question or reply, as the transcript shows it. */
export type SideChatContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'file'; readonly attachment: FileAttachmentRef }

/** One child-owned message; inherited messages are excluded. */
export interface SideChatMessage {
  readonly role: 'user' | 'assistant'
  readonly content: readonly SideChatContentBlock[]
}

/**
 * How a submitted question is delivered while the child is still replying.
 *
 * `queue` waits for the next turn; `steer` is delivered at the running turn's
 * next step. An idle child always starts a turn, so the mode only matters in
 * the busy state — the same choice the main composer offers.
 */
export type SideChatDeliveryMode = 'queue' | 'steer'

/**
 * One question admitted into the child's inbox but not delivered yet.
 *
 * The shape mirrors the session controller's `SessionQueuedItem`, so the shared
 * queue dock renders a waiting question exactly as it renders a waiting main
 * turn: `content` carries the blocks (text, image, file), and the presentation
 * fields come from the same derivation the main queue uses.
 */
export interface SideChatQueuedItem {
  /** Inbox occurrence identity; the queue-mutation verb addresses it. */
  readonly id: string
  /** The queue this question sits in. */
  readonly placement: 'queued' | 'steering'
  /** JSON-safe message fields consumed by pending-queue presentation. */
  readonly message: {
    readonly id: string
    readonly content: readonly SideChatContentBlock[]
  }
}

/** Live conversation state; inherited messages are excluded. */
export interface SideChatSnapshot {
  readonly messages: readonly SideChatMessage[]
  readonly running: boolean
  /** Admitted questions still awaiting delivery, in inbox order. */
  readonly pending: readonly SideChatQueuedItem[]
  readonly error?: string
}

/** One attachment the reader is adding to a question, before admission. */
export type SideChatUploadPart =
  | {
    readonly type: 'image'
    /** Canonical base64 bytes. */
    readonly data: string
    /** Caller-declared image media type, verified against the decoded bytes. */
    readonly mediaType: string
    /** Optional display name. */
    readonly name?: string
  }
  | {
    readonly type: 'file'
    /** Canonical base64 bytes. */
    readonly data: string
    /** Display name, also the stored object's leaf name. */
    readonly name: string
  }

/** Admit one attachment before a question references it. */
export interface SideChatUploadRequest {
  /** The open side conversation's own session id. */
  readonly sessionId: string
  /** The attachment bytes to admit. */
  readonly part: SideChatUploadPart
}

/** The admitted block, or the refusal to show beside the draft. */
export type SideChatUploadValue =
  | { readonly ok: true; readonly block: SideChatContentBlock }
  | { readonly ok: false; readonly message: string }

/** Submit a question to an open side conversation. */
export interface SideChatSendRequest {
  readonly sessionId: string
  /** Question content in order: text and already-admitted attachment blocks. */
  readonly content: readonly SideChatContentBlock[]
  /** Delivery while the child is replying; absent queues it for the next turn. */
  readonly mode?: SideChatDeliveryMode
}

/** Admission result; failures preserve the caller's draft. */
export type SideChatSendValue = { readonly ok: true } | { readonly ok: false; readonly message: string }

/** Read one attachment back for display. */
export interface SideChatAttachmentRequest {
  /** The open side conversation's own session id. */
  readonly sessionId: string
  /** The attachment to read, as referenced by that conversation's messages. */
  readonly attachmentId: string
}

/** The verified bytes, or the refusal to show in place of the attachment. */
export type SideChatAttachmentValue =
  | { readonly ok: true; readonly mediaType: string; readonly data: string }
  | { readonly ok: false; readonly message: string }

/** Result of opening a side conversation. */
export type SideChatOpenValue =
  | { readonly ok: true; readonly sideChat: SideChatView }
  | { readonly ok: false; readonly reason: SideChatFailureReason; readonly message: string }

/** Close one side conversation. */
export interface SideChatCloseRequest {
  /** The side conversation's own session id. */
  readonly sessionId: string
}

/** Whether a close removed an open side conversation. */
export interface SideChatCloseValue {
  readonly closed: boolean
}

/** List the open side conversations for one parent. */
export interface SideChatListRequest {
  /** The parent session whose side conversation is wanted. */
  readonly parentSessionId: string
}

/** The open side conversation for one parent, if any. */
export interface SideChatListValue {
  readonly sideChat?: SideChatView
  readonly snapshot?: SideChatSnapshot
}
