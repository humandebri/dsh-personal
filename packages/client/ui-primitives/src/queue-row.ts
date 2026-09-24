/**
 * How one pending queue row reads.
 *
 * Every composer that shows a pending queue — the main conversation and the
 * side-chat panel — derives its rows through this one function, so a waiting
 * turn is described identically wherever it is shown.
 *
 * Queue content arrives as wire data from two different composers, so this
 * module narrows it here instead of importing either one's protocol types.
 */

/** Characters of flattened text a queue row previews before it is cut. */
const QUEUE_PREVIEW_CHARS = 200

/** The durable image reference one queue row can show. */
export interface QueueStripImageRef {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
}

/** The durable file reference one queue row can show. */
export interface QueueStripFileRef {
  readonly attachmentId: string
  readonly name: string
  readonly bytes: number
}

/** One renderable piece of a waiting question. */
export type QueueStripBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly attachment: QueueStripImageRef }
  | { readonly type: 'file'; readonly attachment: QueueStripFileRef }

/** How one pending queue row reads: its text preview, and its editable text. */
export interface QueueRowPresentation {
  /** One-line preview of everything the row shows as text. */
  readonly preview: string
  /** The row's text, or null when it is not text-only and cannot be edited in place. */
  readonly text: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow one foreign content array to the blocks a queue row renders.
 *
 * Tool exchanges and unknown future blocks carry no queue presentation, so they
 * are dropped here rather than leaking into a preview.
 * @param content - the row's content, as the producing composer stores it.
 * @returns the renderable blocks, in order.
 */
export function queueStripBlocks(content: readonly unknown[]): QueueStripBlock[] {
  const blocks: QueueStripBlock[] = []
  for (const candidate of content) {
    if (!isRecord(candidate)) continue
    if (candidate['type'] === 'text' && typeof candidate['text'] === 'string') {
      if (candidate['text'] !== '') blocks.push({ type: 'text', text: candidate['text'] })
    } else if (candidate['type'] === 'image' && isRecord(candidate['attachment'])) {
      blocks.push({ type: 'image', attachment: candidate['attachment'] as unknown as QueueStripImageRef })
    } else if (candidate['type'] === 'file' && isRecord(candidate['attachment'])) {
      blocks.push({ type: 'file', attachment: candidate['attachment'] as unknown as QueueStripFileRef })
    }
  }
  return blocks
}

/**
 * Derive one pending row's presentation from its content.
 * @param content - the row's content, as the producing composer stores it.
 * @returns the preview text and the editable text.
 */
export function queueRowPresentation(content: readonly unknown[]): QueueRowPresentation {
  const texts: string[] = []
  // The preview is built from the raw content, so an unrecognized block still
  // names itself rather than vanishing from the row's description.
  const parts: string[] = []
  let textOnly = true
  for (const candidate of content) {
    const type = isRecord(candidate) ? candidate['type'] : undefined
    const text = isRecord(candidate) && typeof candidate['text'] === 'string' ? candidate['text'] : undefined
    if (type !== 'text' || text === undefined) {
      // Any non-text block — including one whose attachment is malformed — makes
      // the row non-editable: an in-place edit would submit text alone.
      textOnly = false
      if (type !== 'image' && type !== 'file') parts.push(`[${String(type)}]`)
      continue
    }
    texts.push(text)
    parts.push(text)
  }
  const flat = parts.join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  const preview = chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
  return { preview, text: textOnly ? texts.join('') : null }
}
