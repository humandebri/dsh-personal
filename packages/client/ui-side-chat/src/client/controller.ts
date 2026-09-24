import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SideChatClient } from '@deepseek-ai/dsh-side-chat/client'
import type { SideChatListValue } from '@deepseek-ai/dsh-side-chat/types'

/** Server-owned transcript snapshots, polled only while a tab is mounted. */
export class SideChatController {
  /** Latest snapshot per parent Session; the tab body selects its own entry. */
  readonly state = createSnapshotStore<Record<string, SideChatListValue & { error?: string }>>({})
  private readonly watched = new Map<string, { count: number; timer?: ReturnType<typeof setTimeout> }>()

  /**
   * @param client - the side-chat Remote face this controller polls.
   * @param interval - poll interval in milliseconds.
   */
  constructor(private readonly client: Pick<SideChatClient, 'read'>, private readonly interval: number) {}

  /**
   * Start (or join) the poll for one parent and return its release.
   * @param parent - the parent Session whose child is displayed.
   * @returns the disposer that stops polling once the last consumer releases.
   */
  acquire(parent: string): () => void {
    const existing = this.watched.get(parent)
    if (existing) existing.count++
    else {
      const entry = { count: 1 } as { count: number; timer?: ReturnType<typeof setTimeout> }
      this.watched.set(parent, entry)
      const poll = async () => {
        try {
          const value = await this.client.read(parent)
          if (this.watched.get(parent) === entry) this.state.update(state => { state[parent] = value })
        } catch (error: unknown) {
          if (this.watched.get(parent) === entry) this.state.update(state => {
            state[parent] = { ...state[parent], error: String(error) }
          })
        }
        if (this.watched.get(parent) === entry) entry.timer = setTimeout(() => { void poll() }, this.interval)
      }
      void poll()
    }
    return () => {
      const entry = this.watched.get(parent)
      if (!entry || --entry.count > 0) return
      clearTimeout(entry.timer)
      this.watched.delete(parent)
    }
  }

  /** Stop every poll; wired to the owning plugin's disposal. */
  dispose(): void {
    for (const entry of this.watched.values()) clearTimeout(entry.timer)
    this.watched.clear()
  }
}
