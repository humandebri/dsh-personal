/**
 * Shared pending-queue strip.
 *
 * The main composer and the side-chat panel run the same queue, so both render
 * this component: one waiting question behaves identically in either place —
 * edit in place, remove, or steer into the running turn, with a local
 * submission echo that cannot be acted on until its Host row arrives. Callers
 * supply their own rows and their own mutation verb; the component owns the
 * presentation and the per-row busy state.
 */

import { useEffect, useId, useState, type ReactNode } from 'react'
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular,
  IconEditOutlineRegular, IconQueueOutlineRegular, IconSendOutlineRegular, IconTrashOutlineRegular,
} from './icons/index.tsx'
import { FileTypeIcon } from './FileTypeIcon.tsx'
import { fileSizeText } from './file-size.ts'
import { projectUserText } from './user-text.tsx'
import { Tooltip } from './Tooltip.tsx'
import { queueRowPresentation, queueStripBlocks, type QueueStripFileRef, type QueueStripImageRef } from './queue-row.ts'
import css from './QueueStrip.module.css'

/** Address of one pending queue occurrence, owned by the calling composer. */
export type QueueStripItemId = string

/** One mutation this strip may request; the caller maps it onto its own verb. */
export type QueueStripAction =
  | { readonly kind: 'edit'; readonly content: readonly { readonly type: 'text'; readonly text: string }[] }
  | { readonly kind: 'remove' }
  | { readonly kind: 'steer' }

/** One local attachment a submission echo shows before its Host row arrives. */
export type QueueStripEchoAttachment =
  | { readonly type: 'image'; readonly value: { readonly previewUrl: string } }
  | { readonly type: 'file'; readonly value: QueueStripFileRef }

/** One row the queue strip renders, in delivery order. */
export type QueueStripRow =
  | {
    /** A durable pending occurrence: editable and mutable. */
    readonly kind: 'waiting'
    readonly id: QueueStripItemId
    /** The row's content, as the producing composer stores it. */
    readonly content: readonly unknown[]
  }
  | {
    /** A local submission whose Host row has not arrived yet. */
    readonly kind: 'echo'
    readonly id: string
    readonly text: string
    readonly attachments: readonly QueueStripEchoAttachment[]
  }

/** Copy keys the strip translates; the calling composer owns the dictionary. */
export type QueueStripKey =
  | 'queue.count'
  | 'queue.sending'
  | 'queue.edit'
  | 'queue.edit.unsupported'
  | 'queue.save'
  | 'queue.cancelEdit'
  | 'queue.remove'
  | 'queue.steer'
  | 'queue.steer.unavailable'
  | 'queue.editFailed'
  | 'queue.removeFailed'
  | 'queue.steerFailed'
  | 'queue.image'
  | 'queue.file'

/** Translate one strip key; the caller binds its own namespace. */
export type QueueStripTranslate = (key: QueueStripKey, params?: Record<string, unknown>) => string

/** Queue operations the owning composer injects. */
export interface QueueStripInjected {
  /** Apply one mutation to a still-pending occurrence. */
  updateQueue: (itemId: QueueStripItemId, action: QueueStripAction) => Promise<void>
  /** Report one failed mutation; the owning composer owns the surface. */
  notify: (level: 'info' | 'error', text: string) => void
  /** Resolve one queued image into a displayable URL; absent renders no thumbnail. */
  loadImage?: (attachment: QueueStripImageRef) => Promise<string>
}

/** Props of the shared queue strip. */
export interface QueueStripProps extends QueueStripInjected {
  /** Rows in delivery order. */
  readonly rows: readonly QueueStripRow[]
  /** Whether the addressed agent is running (steering is only available then). */
  readonly running: boolean
  /** Whether this composer may mutate the queue at all. */
  readonly mutable: boolean
  readonly t: QueueStripTranslate
}

/**
 * Durable references carried by one queued row. Queue frames are wire data
 * despite their typed face, so an image block without a reference is skipped
 * rather than trusted.
 * @param content - the row's wire content blocks.
 * @returns the row's durable image references in block order.
 */
function queueAttachments(content: readonly unknown[]): Array<
  | { readonly type: 'image'; readonly attachment: QueueStripImageRef }
  | { readonly type: 'file'; readonly attachment: QueueStripFileRef }
> {
  const attachments: Array<
    | { readonly type: 'image'; readonly attachment: QueueStripImageRef }
    | { readonly type: 'file'; readonly attachment: QueueStripFileRef }
  > = []
  for (const block of queueStripBlocks(content)) {
    if (block.type === 'image') attachments.push(block)
    if (block.type === 'file') attachments.push(block)
  }
  return attachments
}

/** Compact file identity used beside queue thumbnails. */
function QueueFile({ attachment, label }: { attachment: QueueStripFileRef; label: string }) {
  return (
    <span className={css.file} aria-label={label} title={attachment.name}>
      <span className={css.fileIcon} aria-hidden><FileTypeIcon path={attachment.name} size={16} /></span>
      <span className={css.fileName}>{attachment.name}</span>
      <span className={css.fileSize}>{fileSizeText(attachment.bytes)}</span>
    </span>
  )
}

/** One durable queued image as a fixed-size thumbnail; a load failure keeps the empty placeholder. */
function QueueThumb({ attachment, loadImage, label }: {
  attachment: QueueStripImageRef
  loadImage: QueueStripInjected['loadImage']
  label: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadImage?.(attachment).then(
      (resolved) => { if (alive) setUrl(resolved) },
      () => { /* placeholder retained; the durable transcript surfaces read errors */ },
    )
    return () => { alive = false }
  }, [attachment, loadImage])
  return url === null
    ? <span className={css.thumb} aria-hidden />
    : <img className={css.thumb} src={url} alt={label} />
}

/**
 * Render the pending queue: one row per waiting question, with the operations
 * its composer permits.
 * @param props - rows, the mutation verb, and localized copy.
 * @returns the queue strip, or null while nothing is pending.
 */
export function QueueStrip({ rows, running, mutable, updateQueue, notify, loadImage, t }: QueueStripProps): ReactNode {
  const [editing, setEditing] = useState<{ id: QueueStripItemId; text: string } | null>(null)
  const [busy, setBusy] = useState<QueueStripItemId | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()

  useEffect(() => {
    if (rows.length === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!mutable || !rows.some(row => row.kind === 'waiting' && row.id === editing.id))) setEditing(null)
  }, [collapsed, editing, mutable, rows])

  if (rows.length === 0) return null

  const interactionActive = mutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive
  const listVisible = rows.length === 1 || expanded

  const applyAction = async (
    itemId: QueueStripItemId,
    action: QueueStripAction,
    failure: string,
  ): Promise<boolean> => {
    setBusy(itemId)
    try {
      await updateQueue(itemId, action)
      return true
    } catch {
      notify('error', failure)
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }

  const saveEdit = async (): Promise<void> => {
    if (editing === null || editing.text.trim() === '') return
    if (await applyAction(
      editing.id,
      { kind: 'edit', content: [{ type: 'text', text: editing.text }] },
      t('queue.editFailed'),
    )) setEditing(null)
  }

  return (
    <div className={css.dock} data-queue-dock="">
      <div className={css.panel}>
        {rows.length > 1 && (
          <button
            type="button"
            className={css.header}
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <span className={css.lead} aria-hidden><IconQueueOutlineRegular size={14} /></span>
            <span className={css.count}>{t('queue.count', { n: rows.length })}</span>
            {!listVisible && rows.some(row => row.kind === 'echo') && (
              <span className={css.status} role="status">{t('queue.sending')}</span>
            )}
            <span className={css.chevron} aria-hidden>
              {expanded ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronUpOutlineRegular size={14} />}
            </span>
          </button>
        )}
        <ul id={listId} className={css.list} hidden={!listVisible}>
          {listVisible && rows.map((row) => {
            if (row.kind === 'echo') {
              return (
                <li key={row.id} className={`${css.row} ${css.pendingRow}`} data-submission-echo="">
                  {rows.length === 1 && <span className={css.lead} aria-hidden><IconQueueOutlineRegular size={14} /></span>}
                  {row.attachments.length > 0 && (
                    <span className={css.attachments}>
                      {row.attachments.map((attachment, index) => attachment.type === 'image'
                        ? (
                          <img
                            key={`${(attachment.value as { previewUrl: string }).previewUrl}:${index}`}
                            className={css.thumb}
                            src={(attachment.value as { previewUrl: string }).previewUrl}
                            alt={t('queue.image')}
                          />
                        )
                        : (
                          <QueueFile
                            key={`${attachment.value.attachmentId}:${attachment.value.name}:${index}`}
                            attachment={attachment.value}
                            label={t('queue.file', { name: attachment.value.name })}
                          />
                        ))}
                    </span>
                  )}
                  <span className={css.preview}>{projectUserText(row.text, [])}</span>
                  <span className={css.status} role="status">{t('queue.sending')}</span>
                  {mutable && <div className={css.actions}>
                    <button
                      type="button"
                      className={css.action}
                      aria-label={t('queue.edit')}
                      title={t('queue.sending')}
                      disabled
                    >
                      <IconEditOutlineRegular size={14} />
                    </button>
                    <button
                      type="button"
                      className={css.action}
                      aria-label={t('queue.remove')}
                      title={t('queue.sending')}
                      disabled
                    >
                      <IconTrashOutlineRegular size={14} />
                    </button>
                    <button
                      type="button"
                      className={css.action}
                      aria-label={t('queue.steer')}
                      title={t('queue.sending')}
                      disabled
                    >
                      <IconSendOutlineRegular size={14} />
                    </button>
                  </div>}
                </li>
              )
            }
            const { preview, text } = queueRowPresentation(row.content)
            const attachments = queueAttachments(row.content)
            return (
              <li key={row.id} className={css.row}>
                {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
                {rows.length === 1 && <span className={css.lead} aria-hidden><IconQueueOutlineRegular size={14} /></span>}
                {editing?.id === row.id
                  ? (
                    <input
                      autoFocus
                      className={css.editor}
                      aria-label={t('queue.edit')}
                      value={editing.text}
                      onChange={(event) => { setEditing({ id: row.id, text: event.currentTarget.value }) }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditing(null)
                          return
                        }
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                          event.preventDefault()
                          void saveEdit()
                        }
                      }}
                    />
                  )
                  : (
                    <>
                      {attachments.length > 0 && (
                        <span className={css.attachments}>
                          {attachments.map((item, index) => item.type === 'image'
                            ? (
                              <QueueThumb
                                key={`${item.attachment.attachmentId}:${index}`}
                                attachment={item.attachment}
                                loadImage={loadImage}
                                label={t('queue.image')}
                              />
                            )
                            : (
                              <QueueFile
                                key={`${item.attachment.attachmentId}:${item.attachment.name}:${index}`}
                                attachment={item.attachment}
                                label={t('queue.file', { name: item.attachment.name })}
                              />
                            ))}
                        </span>
                      )}
                      <span className={css.preview}>{projectUserText(preview, [])}</span>
                    </>
                  )}
                {mutable && <div className={css.actions}>
                  {editing?.id === row.id
                    ? (
                      <>
                        <Tooltip label={t('queue.save')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.save')}
                            disabled={busy !== null || editing.text.trim() === ''}
                            onClick={() => { void saveEdit() }}
                          >
                            <IconCheckOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.cancelEdit')}
                            disabled={busy !== null}
                            onClick={() => { setEditing(null) }}
                          >
                            <IconCloseOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                      </>
                    )
                    : (
                      <>
                        <Tooltip label={t('queue.edit')} side="bottom" delayMs={500} disabled={text === null}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.edit')}
                            // Disabled buttons fire no hover events, so the
                            // unsupported hint stays a native title.
                            title={text === null ? t('queue.edit.unsupported') : undefined}
                            disabled={busy !== null || text === null}
                            onClick={() => {
                              if (text !== null) setEditing({ id: row.id, text })
                            }}
                          >
                            <IconEditOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('queue.remove')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.remove')}
                            disabled={busy !== null}
                            onClick={() => {
                              void applyAction(
                                row.id,
                                { kind: 'remove' },
                                t('queue.removeFailed'),
                              )
                            }}
                          >
                            <IconTrashOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('queue.steer')} side="bottom" delayMs={500} disabled={!running}>
                          <button
                            type="button"
                            className={css.action}
                            aria-label={t('queue.steer')}
                            title={running ? undefined : t('queue.steer.unavailable')}
                            disabled={busy !== null || !running}
                            onClick={() => {
                              void applyAction(
                                row.id,
                                { kind: 'steer' },
                                t('queue.steerFailed'),
                              )
                            }}
                          >
                            <IconSendOutlineRegular size={14} />
                          </button>
                        </Tooltip>
                      </>
                    )}
                </div>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
