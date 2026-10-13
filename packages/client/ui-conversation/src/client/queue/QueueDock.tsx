import type { Context } from '@deepseek-ai/cordis'
import { useMemo } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { QueueStrip, type QueueStripRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { QueueAction } from '@deepseek-ai/dsh-api-session-controller/types'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { NS } from '../locales.ts'

const EMPTY_QUEUE = [] as const

/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
  updateQueue: (itemId: MessageId, action: QueueAction) => Promise<void>
  notify: (level: 'info' | 'error', text: string) => void
  /** Resolve one durable queued image into a session-scoped browser URL. */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
}

export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>

/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header; an empty queue renders nothing. Local queued submissions
 * show sending status and disabled actions until their Host queue rows arrive.
 */
export function QueueDock({ useSession, useProjection, updateQueue, notify, loadImage, t }: QueueDockProps) {
  const inbox = useProjection('inbox') as InboxState | undefined
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  const queue = useMemo(() => {
    const rows = inbox?.['next-turn'] ?? EMPTY_QUEUE
    const inChat = new Set(pendingSubmissions.filter(item => item.placement === 'transcript').map(item => item.requestId))
    return inChat.size === 0 ? rows : rows.filter(({ source }) => (
      source.kind !== 'user' || !('rpcId' in source) || !inChat.has(source.rpcId)
    ))
  }, [inbox, pendingSubmissions])
  const pendingQueue = useMemo(() => {
    const admitted = new Set(queue.flatMap(({ source }) => (
      source.kind === 'user' && 'rpcId' in source ? [source.rpcId] : []
    )))
    return pendingSubmissions.filter(submission => (
      submission.placement === 'queued' && !admitted.has(submission.requestId)
    ))
  }, [pendingSubmissions, queue])
  const running = useSession(s => s.running)
  const mutable = useSession(s => s.subagent === null || s.subagent.address.mode === 'continuable')
  const rows: QueueStripRow[] = [
    ...queue.map(row => ({ kind: 'waiting' as const, id: row.id, content: row.content })),
    ...pendingQueue.map(row => ({ kind: 'echo' as const, id: row.requestId, text: row.text, attachments: row.attachments })),
  ]
  return <QueueStrip rows={rows} running={running} mutable={mutable} t={t}
    notify={notify} loadImage={attachment => loadImage(attachment as ImageAttachmentRef)}
    updateQueue={(id, action) => updateQueue(id as MessageId, action)} />
}

/** Registers queue actions backed by the session-scoped conversation service. */
export const queueDockEntry = {
  name: 'conversation-queue-dock',
  inject: ['slots', 'conversation', 'sessions', 'uiConversation'],
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'queue',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId): QueueDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
        const conversation = actx.get('conversation')
        if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
        return {
          updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
          notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
          loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
        }
      },
    }, QueueDock))
  },
}
