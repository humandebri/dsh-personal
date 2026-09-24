/** General Settings row for the transcript width drag lock. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ContentWidthRow.module.css'

/** Registration-side transcript width lock face. */
export interface ContentWidthRowInjected {
  hooks: {
    /** Persisted transcript width lock bound as useContentWidthLocked. */
    contentWidthLocked: SnapshotStore<boolean>
  }
  /** Change the transcript width drag lock. */
  setContentWidthLocked: (locked: boolean) => void
}

/** Full Settings-row props. */
export type ContentWidthRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ContentWidthRowInjected>

/**
 * Render the transcript width lock toggle.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ContentWidthRow({ useContentWidthLocked, setContentWidthLocked, t }: ContentWidthRowProps) {
  const locked = useContentWidthLocked(value => value)
  const title = t('settings.contentWidth.title')
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.desc}>{t('settings.contentWidth.description')}</div>
      </div>
      <Switch checked={locked} label={title} onChange={setContentWidthLocked} />
    </div>
  )
}
