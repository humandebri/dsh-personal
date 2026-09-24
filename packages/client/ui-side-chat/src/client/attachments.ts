/**
 * Draft attachments for the side-chat composer.
 *
 * The panel attaches with the same two-step shape the main composer uses —
 * admit the bytes against the conversation, then submit the admitted block —
 * but against its own ephemeral child, so no session-scoped upload service is
 * involved and nothing is staged before the reader submits.
 */

import type { SideChatContentBlock, SideChatUploadPart } from '@deepseek-ai/dsh-side-chat/types'

/** Browser-declared image types the attachment service admits. */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** One attachment the reader staged for the next question. */
export interface DraftAttachment {
  /** Local identity for the draft list. */
  readonly id: string
  /** Display name, as the question will carry it. */
  readonly name: string
  /** Exact byte length, for the draft label. */
  readonly bytes: number
  /** Object URL previewing a local image; revoked when the draft is released. */
  readonly previewUrl?: string
  /** `uploading` until the Host admits it, `ready` once it may be submitted. */
  readonly status: 'uploading' | 'ready' | 'error'
  /** The admitted block a `ready` draft submits. */
  readonly block?: SideChatContentBlock
  /** The refusal to show for a failed draft. */
  readonly error?: string
}

/**
 * Canonical base64 of one browser file, without a main-thread byte loop.
 * @param file - the reader's file.
 * @returns the file's canonical base64 bytes.
 */
export function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => { reject(reader.error ?? new Error('side chat: attachment read failed')) }
    reader.readAsDataURL(file)
  })
}

/**
 * The wire part one browser file uploads as.
 * @param file - the reader's file.
 * @returns the admission part, keyed by the browser-declared media type.
 */
export async function uploadPartOf(file: File): Promise<SideChatUploadPart> {
  const data = await base64Of(file)
  return IMAGE_MEDIA_TYPES.has(file.type)
    ? { type: 'image', data, mediaType: file.type, name: file.name }
    : { type: 'file', data, name: file.name }
}

/**
 * Whether a staged attachment may be submitted.
 * @param attachment - one draft attachment.
 * @returns true once the Host admitted its bytes.
 */
export function isReady(attachment: DraftAttachment): boolean {
  return attachment.status === 'ready'
}

/**
 * The blocks one question submits: its text, then its ready attachments.
 * @param text - the trimmed draft text, or an empty string.
 * @param attachments - the staged attachments in reader order.
 * @returns the question content, or an empty list when there is nothing to ask.
 */
export function questionContent(
  text: string,
  attachments: readonly DraftAttachment[],
): SideChatContentBlock[] {
  const content: SideChatContentBlock[] = []
  if (text.trim() !== '') content.push({ type: 'text', text })
  for (const attachment of attachments) {
    if (attachment.block !== undefined) content.push(attachment.block)
  }
  return content
}

/**
 * Release the browser resources one draft attachment owns.
 * @param attachment - the draft being dropped.
 */
export function releaseAttachment(attachment: DraftAttachment): void {
  if (attachment.previewUrl !== undefined) URL.revokeObjectURL(attachment.previewUrl)
}
