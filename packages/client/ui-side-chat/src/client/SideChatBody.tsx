/**
 * The side-chat tab body: a compact transcript and composer for one ephemeral
 * child session.
 *
 * The child inherits the parent's history, so the transcript already carries
 * conversation. The body deliberately renders only the child's own exchange —
 * the inherited prefix is reference material the model sees, not something the
 * reader needs re-read — and keeps a one-line banner saying so.
 *
 * Questions and answers carry the same content blocks the main thread uses
 * (text, images, files), and the pending queue is the shared strip the main
 * composer renders, so both places behave alike: attach, queue, steer, stop.
 *
 * A tab may arrive without a child id: the guide opens a page type with no
 * parameters, so picking **Side chat** there produces exactly that. The body
 * therefore opens the conversation itself when it has none, which keeps the
 * guide path and the header action on one implementation.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ClipboardEvent, type DragEvent, type ReactNode,
} from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import {
  IconCloseOutlineRegular, IconPaperclipOutlineRegular, IconSendOutlineRegular, IconStopFillRegular,
  MarkdownText, QueueStrip, Tooltip, fileSizeText, type MarkdownLabels,
  type QueueStripRow,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SideChatDeliveryMode } from '@deepseek-ai/dsh-side-chat/types'
import type { SideChatBodyInjected } from './contract.ts'
import { questionContent, releaseAttachment, uploadPartOf, type DraftAttachment } from './attachments.ts'
import { createComposerCompositionWatch, plainEnterBreaksLine } from './composer-enter.ts'
import { NS } from './locales.ts'
import css from './SideChatBody.module.css'

/** Standard sidebar owner share plus the parent session and localized copy. */
export type SideChatBodyProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>
  & InjectFace<SideChatBodyInjected>

/** One referenced image, resolved through this conversation's own child. */
function SideChatImage({ child, attachment, imageUrl, label, className }: {
  child: string
  attachment: ImageAttachmentRef
  imageUrl: SideChatBodyInjected['imageUrl']
  label: string
  className?: string | undefined
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    imageUrl(child, attachment).then(
      (resolved) => { if (alive) setUrl(resolved) },
      () => { /* the error strip owns read failures; the placeholder stays */ },
    )
    return () => { alive = false }
  }, [attachment, child, imageUrl])
  return url === null
    ? <span className={className} aria-hidden />
    : <img className={className} src={url} alt={label} />
}

/**
 * Render one side conversation with its own composer.
 * @param props - sidebar occurrence, parent session, and translated copy.
 * @returns the transcript, boundary banner, and composer.
 */
export function SideChatBody({
  useTabInfo, sessionId, openSideChat, useSideChatState, useBusyEnter,
  watch, send, upload, updateQueue, imageUrl, queueT, stop, t,
}: SideChatBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const state = useSideChatState(snapshot => snapshot[sessionId])
  const busyEnter = useBusyEnter(selected => selected)
  useEffect(() => watch(sessionId), [watch, sessionId])
  const submitting = useRef(false)
  const transcript = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = transcript.current
    if (element !== null && typeof element.scrollTo === 'function') element.scrollTo(0, element.scrollHeight)
  }, [state?.snapshot?.messages.length])
  const params = tab.navigation.params
  const paramChildId = params !== undefined && 'sideChatId' in params ? params.sideChatId : undefined

  // The conversation opened by this body when the tab arrived without one, so a
  // guide pick and a header action converge on the same rendering.
  const [openedChildId, setOpenedChildId] = useState<string | undefined>(undefined)
  const childId = paramChildId ?? openedChildId
  const [draft, setDraft] = useState('')
  const [drafts, setDrafts] = useState<readonly DraftAttachment[]>([])
  const staged = useRef<readonly DraftAttachment[]>(drafts)
  useEffect(() => { staged.current = drafts }, [drafts])
  // A previewed object URL belongs to the tab: release every one when it closes.
  useEffect(() => () => { for (const entry of staged.current) releaseAttachment(entry) }, [])
  const mints = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  // The composer's Enter rule lives in composer-enter.ts; the IME watch is one
  // instance per mounted body, so a composition never leaks between tabs.
  const [composition] = useState(createComposerCompositionWatch)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const snapshotError = state?.error ?? state?.snapshot?.error
  const running = state?.snapshot?.running === true
  const uploading = drafts.some(attachment => attachment.status === 'uploading')
  const content = questionContent(draft, drafts)
  // While the child replies, the button names the delivery Enter would use, as
  // the main composer's Send does.
  const sendLabel = running ? t(busyEnter === 'steer' ? 'sendSteer' : 'sendQueue') : t('send')

  // The hidden boundary message is injected by the Host, so the reader never
  // sees it; this banner is the human-readable equivalent.
  const banner = useMemo(() => t('boundary'), [t])
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('footnotes'),
  }), [t])
  // Waiting questions render through the shared strip; steering rows are
  // delivered at the running turn's next step, exactly as the main queue does.
  const queueRows = useMemo<readonly QueueStripRow[]>(() => (state?.snapshot?.pending ?? [])
    .filter(row => row.placement === 'queued')
    .map(row => ({
      kind: 'waiting' as const,
      id: row.id,
      content: row.message.content as unknown as readonly ContentBlock[],
    })), [state?.snapshot?.pending])

  // Match the main composer: grow with the draft until the local scroll cap,
  // then keep the caret area scrollable instead of resizing the whole pane.
  useLayoutEffect(() => {
    const element = input.current
    if (element === null) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [draft])

  useEffect(() => {
    if (paramChildId !== undefined) return
    let live = true
    void openSideChat(sessionId).then((outcome) => {
      if (!live) return
      if (outcome.ok) setOpenedChildId(outcome.sideChatId)
      else setFailure(outcome.message)
    }).catch((error: unknown) => {
      if (live) setFailure(String(error))
    })
    return () => { live = false }
  }, [openSideChat, paramChildId, sessionId])

  /**
   * Stage reader files: preview them locally, then admit their bytes against
   * this conversation so the next question can reference them.
   * @param files - the files the reader attached.
   */
  const stageFiles = (files: readonly File[]): void => {
    if (childId === undefined || files.length === 0) return
    const child = childId
    for (const file of files) {
      mints.current += 1
      const staged: DraftAttachment = {
        id: `draft-${mints.current}`,
        name: file.name,
        bytes: file.size,
        ...(file.type.startsWith('image/') ? { previewUrl: URL.createObjectURL(file) } : {}),
        status: 'uploading',
      }
      setDrafts(current => [...current, staged])
      void (async () => {
        try {
          const block = await upload(child, await uploadPartOf(file))
          setDrafts(current => current.map(entry => entry.id === staged.id ? { ...entry, status: 'ready', block } : entry))
        } catch (error: unknown) {
          setDrafts(current => current.map(entry => entry.id === staged.id ? { ...entry, status: 'error', error: String(error) } : entry))
        }
      })()
    }
  }

  /** Drop one staged attachment and its preview. */
  const removeAttachment = (id: string): void => {
    const found = drafts.find(entry => entry.id === id)
    if (found !== undefined) releaseAttachment(found)
    setDrafts(current => current.filter(entry => entry.id !== id))
  }

  /**
   * Resolve one submission gesture into a delivery mode.
   *
   * An idle child starts a turn whatever the mode, so only the busy state
   * distinguishes the two. The plain Enter gesture (and the Send button, which
   * shares it) takes the shared busy-Enter preference, and the accelerated
   * chord takes the opposite — the rule the main composer applies.
   * @param accelerated - whether the chord, rather than plain Enter, submitted.
   * @returns the delivery mode for this submission.
   */
  const submitMode = useCallback((accelerated: boolean): SideChatDeliveryMode => {
    if (!running) return 'queue'
    if (!accelerated) return busyEnter
    return busyEnter === 'queue' ? 'steer' : 'queue'
  }, [busyEnter, running])

  const submit = useCallback((accelerated = false) => {
    const asked = questionContent(draft, drafts)
    if (asked.length === 0 || childId === undefined || submitting.current) return
    if (drafts.some(entry => entry.status === 'uploading')) return
    submitting.current = true
    setSending(true)
    setFailure(undefined)
    void (async () => {
      try {
        // The question travels through the side-chat Remote path, which admits
        // it while the child is still replying: the mode picks the delivery.
        await send(childId, asked, submitMode(accelerated))
        for (const entry of drafts) releaseAttachment(entry)
        setDrafts([])
        setDraft('')
      } catch (error: unknown) {
        setFailure(String(error))
      } finally {
        submitting.current = false
        setSending(false)
      }
    })()
  }, [childId, draft, drafts, send, submitMode])

  // Stop is a Host operation, so a refusal is information for the reader, not
  // an exception that would take the tab down.
  const onStop = useCallback(() => {
    if (childId === undefined) return
    setFailure(undefined)
    void stop(childId).catch((error: unknown) => { setFailure(String(error)) })
  }, [childId, stop])

  if (childId === undefined) {
    return (
      <section className={css.root} data-side-chat data-parent-session={sessionId}>
        {/* A refusal here is ordinary: no completed turn yet, or one already
            open. It is a message, not a broken tab. */}
        <p className={failure === undefined ? css.empty : css.error} role="status">
          {failure ?? t('opening')}
        </p>
      </section>
    )
  }

  return (
    <section
      className={css.root}
      data-side-chat
      data-parent-session={sessionId}
      data-side-chat-id={childId}
      data-dragging={dragging ? 'true' : undefined}
      onDragOver={(event: DragEvent<HTMLElement>) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => { setDragging(false) }}
      onDrop={(event: DragEvent<HTMLElement>) => {
        event.preventDefault()
        setDragging(false)
        stageFiles([...event.dataTransfer.files])
      }}
    >
      <div className={css.banner} role="note">{banner}</div>
      <div ref={transcript} className={css.transcript} data-side-chat-transcript role="log" aria-live="polite">
        <div className={css.messageColumn}>
          {(state?.snapshot?.messages.length ?? 0) === 0 && <p className={css.empty}>{t('empty')}</p>}
          {state?.snapshot?.messages.map((message, index) => message.role === 'user' ? (
            <div key={index} className={css.userRow} data-role={message.role}>
              <div className={css.userBubble}>
                {message.content.map((block, blockIndex) => block.type === 'text'
                  ? <span key={blockIndex} className={css.userText}>{block.text}</span>
                  : block.type === 'image'
                    ? (
                      <SideChatImage
                        key={blockIndex}
                        child={childId}
                        attachment={block.attachment}
                        imageUrl={imageUrl}
                        label={t('attachment')}
                        className={css.userImage}
                      />
                    )
                    : (
                      <span key={blockIndex} className={css.userFile} title={block.attachment.name}>
                        {block.attachment.name} · {fileSizeText(block.attachment.bytes)}
                      </span>
                    ))}
              </div>
            </div>
          ) : (
            <div key={index} className={css.assistantMessage} data-role={message.role}>
              <MarkdownText
                text={message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')}
                labels={markdownLabels}
              />
            </div>
          ))}
          {(sending || running) && <p className={css.responding} role="status">{t('responding')}</p>}
        </div>
      </div>
      {snapshotError && <p className={css.error} role="alert">{snapshotError}</p>}
      {state !== undefined && !state.sideChat && !state.error && <p className={css.error} role="alert">{t('closed')}</p>}
      {failure !== undefined && <p className={css.error} role="alert">{failure}</p>}
      {queueRows.length > 0 && (
        <QueueStrip
          rows={queueRows}
          running={running}
          mutable
          updateQueue={(itemId, action) => updateQueue(childId, itemId as MessageId, action)}
          notify={(level, text) => { if (level === 'error') setFailure(text) }}
          // The strip carries only the durable fields it renders; the reader
          // resolves those bytes through this conversation's own child.
          loadImage={attachment => imageUrl(childId, attachment as ImageAttachmentRef)}
          t={queueT}
        />
      )}
      <div className={css.composerDock}>
        {dragging && <p className={css.dropHint} role="status">{t('dropHint')}</p>}
        {drafts.length > 0 && (
          <ul className={css.drafts} aria-label={t('attachments')}>
            {drafts.map(attachment => (
              <li key={attachment.id} className={css.draft} data-status={attachment.status}>
                {attachment.previewUrl === undefined
                  ? <span className={css.draftIcon} aria-hidden><IconPaperclipOutlineRegular size={14} /></span>
                  : <img className={css.draftThumb} src={attachment.previewUrl} alt="" />}
                <span className={css.draftName} title={attachment.name}>{attachment.name}</span>
                <span className={css.draftMeta}>
                  {attachment.status === 'uploading'
                    ? t('attachmentUploading')
                    : attachment.status === 'error'
                      ? attachment.error ?? t('attachmentFailed')
                      : fileSizeText(attachment.bytes)}
                </span>
                <button
                  type="button"
                  className={css.draftRemove}
                  aria-label={t('removeAttachment', { name: attachment.name })}
                  onClick={() => { removeAttachment(attachment.id) }}
                >
                  <IconCloseOutlineRegular size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className={css.composer}
          onSubmit={(event) => { event.preventDefault(); submit() }}
        >
          <textarea
            ref={input}
            className={css.input}
            value={draft}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            rows={1}
            onChange={(event) => { setDraft(event.target.value) }}
            onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
              const files = [...event.clipboardData.files]
              if (files.length === 0) return
              event.preventDefault()
              stageFiles(files)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              // The IME owns a composition-closing Enter: it picks the
              // candidate instead of submitting (see composer-enter.ts).
              if (composition.blocksEnter(event.nativeEvent)) return
              const accelerated = event.metaKey || event.ctrlKey
              // Touch-first: plain Enter belongs to the text, exactly as it does
              // in the main composer; the Send button is the submit gesture.
              if (!accelerated && plainEnterBreaksLine()) return
              event.preventDefault()
              if (event.repeat) return // held-down Enter must not machine-gun sends
              // The accelerated chord submits the opposite of the preference,
              // exactly as it does in the main composer.
              submit(accelerated)
            }}
            onCompositionStart={composition.onCompositionStart}
            onCompositionEnd={composition.onCompositionEnd}
          />
          <div className={css.composerRow}>
            <input
              ref={fileInput}
              className={css.fileInput}
              type="file"
              multiple
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                stageFiles([...(event.currentTarget.files ?? [])])
                event.currentTarget.value = ''
              }}
            />
            <Tooltip label={t('attach')} side="top" delayMs={500}>
              <button
                type="button"
                className={css.attach}
                aria-label={t('attach')}
                onClick={() => { fileInput.current?.click() }}
              >
                <IconPaperclipOutlineRegular size={14} />
              </button>
            </Tooltip>
            <span className={css.enterHint}>{t('enterHint')}</span>
            {running && (
              <button
                type="button"
                className={css.stop}
                aria-label={t('stop')}
                title={t('stop')}
                onClick={onStop}
              >
                <IconStopFillRegular size={14} />
              </button>
            )}
            <button
              type="submit"
              className={css.send}
              aria-label={sendLabel}
              title={sendLabel}
              disabled={sending || uploading || content.length === 0 || state?.sideChat === undefined}
            >
              <IconSendOutlineRegular size={14} />
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
