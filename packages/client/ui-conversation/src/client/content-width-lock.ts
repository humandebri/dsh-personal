/**
 * Transcript width drag lock. The dragged width is a localStorage preference
 * owned by the Conversation shell's width handles; the lock that suppresses
 * those handles lives beside it under its own key, so a locked width survives
 * reload without a Host settings round-trip.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** localStorage key for the transcript width drag lock. */
export const CONTENT_WIDTH_LOCK_KEY = 'dsh.conversation.contentWidthLocked'

/** Resolve the persisted lock; a missing or unrecognized value means unlocked.
 * @returns whether the transcript width drag handles are suppressed. */
function readLock(): boolean {
  return localStorage.getItem(CONTENT_WIDTH_LOCK_KEY) === 'true'
}

/**
 * Transcript width drag lock shared by its General Settings row and the
 * Conversation shell: one live store both spots read, backed by localStorage.
 */
export class ContentWidthLock {
  /** Reactive lock state for the Settings row and the transcript shell. */
  readonly locked: SnapshotStore<boolean> = createSnapshotStore(readLock())

  /**
   * Change the lock; the live value publishes before the durable write starts.
   * @param locked - whether to suppress the transcript width handles.
   */
  setLocked(locked: boolean): void {
    if (this.locked.getSnapshot() === locked) return
    this.locked.set(locked)
    localStorage.setItem(CONTENT_WIDTH_LOCK_KEY, `${locked}`)
  }
}
