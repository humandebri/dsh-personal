/**
 * The header action that opens a side conversation.
 *
 * It performs the whole open here — call the Host, then open or reveal the tab
 * for the returned child — so the tab body never has to handle the opening
 * state. A refusal (no completed turn yet, or one already open) becomes an
 * inline message rather than a thrown error.
 */

import { useCallback, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideChatOpenActionInjected } from './contract.ts'
import { NS } from './locales.ts'
import css from './SideChatOpenAction.module.css'

/** Header-utility owner share plus the parent session and localized copy. */
export type SideChatOpenActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SideChatOpenActionInjected>

/**
 * Render the side-chat toggle for one session.
 * @param props - header occurrence, parent session, and translated copy.
 * @returns the action button and any refusal message.
 */
export function SideChatOpenAction({ parentSessionId, openSideChat, t }: SideChatOpenActionProps): ReactNode {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)

  const run = useCallback(() => {
    if (busy) return
    setBusy(true)
    setMessage(undefined)
    void openSideChat(parentSessionId)
      .then((outcome) => {
        if (!outcome.ok) setMessage(outcome.message)
      })
      .catch((error: unknown) => { setMessage(String(error)) })
      .finally(() => { setBusy(false) })
  }, [busy, openSideChat, parentSessionId])

  return (
    <span className={css.root}>
      <button
        type="button"
        className={css.action}
        onClick={run}
        disabled={busy}
        title={t('openHint')}
        aria-label={t('open')}
      >
        {busy ? t('opening') : t('open')}
      </button>
      {message !== undefined && <span className={css.message} role="status">{message}</span>}
    </span>
  )
}
