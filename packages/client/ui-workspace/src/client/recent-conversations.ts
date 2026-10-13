/** Bounded, navigation-owned history references; entries never own mounted UI. */
import type {
  ISessions, SessionBinding, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface RecentConversation {
  readonly reference: SessionReference
  readonly binding: SessionBinding
  unsubscribe: () => void
  disposeScope: () => void | Promise<void>
}

/** Owns bounded Session references for recently displayed Conversations. */
export class RecentConversations {
  private readonly entries = new Map<SessionId, RecentConversation>()

  constructor(private readonly sessions: ISessions, private readonly limit: number) {}

  /**
   * Acquire before the main reference leaves, keeping its loaded generation alive.
   * @param previous - outgoing main reference whose Session should remain loaded.
   */
  retain(previous: SessionReference): void {
    if (this.limit === 0) return
    const binding = this.sessions.binding(previous.sessionId)
    if (binding === undefined || binding.session.getSnapshot().removed) return
    const target = this.sessions.subagentAddress(previous.sessionId) ?? previous.sessionId
    const reference = this.sessions.retain(target, { source: 'recentConversation' })
    const entry: RecentConversation = {
      reference, binding, unsubscribe: () => {}, disposeScope: () => {},
    }
    this.release(previous.sessionId)
    this.entries.set(previous.sessionId, entry)
    entry.unsubscribe = binding.session.subscribe(() => {
      if (binding.session.getSnapshot().removed) this.release(previous.sessionId, entry)
    })
    entry.disposeScope = binding.ctx.effect(
      () => () => { this.release(previous.sessionId, entry) },
      'ui-workspace: recent Conversation generation',
    )
    void reference.ready.catch(() => { this.release(previous.sessionId, entry) })
    for (const id of this.entries.keys()) {
      if (this.entries.size <= this.limit) break
      this.release(id)
    }
  }

  /**
   * Release after a replacement main reference has acquired the same generation.
   * @param id - retained Session identity.
   * @param expected - exact entry required when called by a generation's cleanup.
   */
  release(id: SessionId, expected?: RecentConversation): void {
    const entry = this.entries.get(id)
    if (entry === undefined || (expected !== undefined && entry !== expected)) return
    this.entries.delete(id)
    entry.unsubscribe()
    void entry.disposeScope()
    entry.reference.release()
  }

  /**
   * Drop archived entries and references whose owning generation has ended.
   * @param archived - current archived Session identities.
   */
  reconcile(archived: readonly SessionId[]): void {
    for (const [id, entry] of this.entries) {
      if (archived.includes(id) || this.sessions.binding(id) !== entry.binding
        || entry.binding.session.getSnapshot().removed) this.release(id, entry)
    }
  }

  /** Release every reference when the navigation owner is disposed. */
  dispose(): void {
    for (const id of this.entries.keys()) this.release(id)
  }
}
