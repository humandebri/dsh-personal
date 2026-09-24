/**
 * Side-conversation tabs for the right Sidebar.
 *
 * The tab is a thin shell over one ephemeral child session: it opens the
 * conversation for its child, and discards that child when the tab closes.
 * Because the child is ephemeral, closing the tab is the only cleanup that
 * exists — there is no durable record to prune and nothing to recover after a
 * reload.
 *
 * The conversation can be reached two ways, and both land on the same body: the
 * Session header action, which knows the child before it places the tab, and
 * the guide capsule, which opens a page type with no parameters at all.
 */

import { z } from 'zod'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SideChatController } from './controller.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SideChatDeliveryMode } from '@deepseek-ai/dsh-side-chat/types'
// These augment Context with the services this plugin injects; the runtime
// values are not needed, only their declarations.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-side-chat/client'
import type {
  SideChatBodyInjected,
  SideChatOpenActionInjected,
  SideChatOpenOutcome,
  SideChatQueueAction,
} from './contract.ts'
import { SideChatBody } from './SideChatBody.tsx'
import { SideChatOpenAction } from './SideChatOpenAction.tsx'
import { en, NS, zh, ja, type SideChatKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Side-chat tab type, transcript, and open action copy. */
    uiSideChat: SideChatKey
  }
}

export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sideChatClient', 'sessions', 'remote', 'remote.session', 'configForms']

/** This plugin's identity in the tab system, and the key its body registers under. */
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-side-chat'

/** Settings namespace whose busy-Enter preference this panel shares. */
const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the busy-Enter preference inside that namespace. */
const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter default, matching the conversation plugin's own default. */
const DEFAULT_BUSY_ENTER: SideChatDeliveryMode = 'queue'

/**
 * Register the side-chat tab type, its body, and the two ways to open it.
 * @param ctx - Client root Context with sidebar, session, and side-chat services.
 */
export const Config = z.object({ pollIntervalMs: z.number().int().min(100).default(1000) }).default({ pollIntervalMs: 1000 })

export function apply(ctx: Context, config: z.infer<typeof Config>): void {
  const controller = new SideChatController(ctx.sideChatClient, config.pollIntervalMs)
  ctx.effect(() => () => controller.dispose(), 'ui-side-chat.polling')
  ctx.effect(() => ctx.locale.register(NS, 'ja', ja), 'ui-side-chat.japanese')
  const generations = new Map<string, number>()
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-side-chat.copy')

  // The composer's busy-Enter preference, owned by the conversation plugin: the
  // side composer offers the same Queue/Steer gestures, so it adopts that one
  // preference rather than keeping a second copy. An absent namespace (a
  // composition without the settings document) keeps the default.
  const busyEnter = createSnapshotStore<SideChatDeliveryMode>(DEFAULT_BUSY_ENTER)
  // The shared queue strip renders conversation-plugin copy; the dictionaries
  // are global to the client locale service, so binding that namespace here
  // shows the same words the main queue shows.
  const queueT = ctx.locale.bind('conversation')
  const preference = ctx.configForms.get<{ busyEnter?: SideChatDeliveryMode }>(CONVERSATION_SETTINGS_NAMESPACE)
  ctx.effect(() => {
    const adopt = (): void => {
      const selected = preference.getSnapshot().value?.[BUSY_ENTER_FIELD]
      if (selected !== undefined) busyEnter.set(selected)
    }
    adopt()
    return preference.subscribe(adopt)
  }, 'ui-side-chat.busy-enter')

  /**
   * Open the side conversation for one parent and reveal its tab.
   *
   * An already-open conversation is revealed rather than duplicated, which is
   * what makes the tab type's single-instance rule hold across both entry
   * points.
   * @param parentSessionId - the session to fork from.
   * @returns the child identity, or the refusal to show.
   */
  const openSideChat = async (parentSessionId: string): Promise<SideChatOpenOutcome> => {
    const generation = generations.get(parentSessionId) ?? 0
    const existing = await ctx.sideChatClient.find(parentSessionId)
    if ((generations.get(parentSessionId) ?? 0) !== generation) return { ok: false, message: t('closed') }
    if (existing !== undefined) {
      ctx.sidebarRight.openTabIn(parentSessionId as SessionId, 'side-chat', {
        params: { sideChatId: existing.sessionId },
      })
      return { ok: true, sideChatId: existing.sessionId }
    }
    const outcome = await ctx.sideChatClient.open(parentSessionId)
    if (!outcome.ok) return { ok: false, message: outcome.message }
    if ((generations.get(parentSessionId) ?? 0) !== generation) {
      await ctx.sideChatClient.close(outcome.sideChat.sessionId)
      return { ok: false, message: t('closed') }
    }
    ctx.sidebarRight.openTabIn(parentSessionId as SessionId, 'side-chat', {
      params: { sideChatId: outcome.sideChat.sessionId },
    })
    return { ok: true, sideChatId: outcome.sideChat.sessionId }
  }

  /**
   * Stop the reply running in one side conversation.
   *
   * The child is an ordinary Session with a live Agent, so its active turn is
   * cancelled through the session controller's own operation — the one the main
   * composer's Stop already uses, pending inbox work included. Only the tab's
   * close discards the child itself.
   * @param child - the side conversation's own session id.
   * @returns whether the Host admitted the cancellation.
   * @throws when the cancellation is refused or the transport fails.
   */
  const stop = async (child: string): Promise<boolean> => {
    const result = await ctx.remote.session.cancel({ sessionId: child as SessionId })
    if (!result.ok) throw new Error(result.error.message)
    return result.value.accepted
  }

  /**
   * Apply one queue mutation through the session controller's own verb.
   *
   * The main composer mutates its queue through that same verb, so a waiting
   * question is validated, edited, and steered by one implementation.
   * @param child - the side conversation's own session id.
   * @param itemId - the waiting row's inbox identity.
   * @param action - the requested mutation.
   */
  const updateQueue = async (child: string, itemId: MessageId, action: SideChatQueueAction): Promise<void> => {
    const result = await ctx.remote.session.updateQueue({
      sessionId: child as SessionId,
      itemId,
      action,
    })
    if (!result.ok) throw new Error(result.error.message)
  }

  /**
   * Resolve one image this conversation references, for display.
   * @param child - the side conversation's own session id.
   * @param attachment - the durable image reference from a message block.
   * @returns a data URL carrying the verified bytes.
   */
  const imageUrl = async (child: string, attachment: ImageAttachmentRef): Promise<string> => {
    const bytes = await ctx.sideChatClient.readAttachment(child, String(attachment.attachmentId))
    return `data:${bytes.mediaType};base64,${bytes.data}`
  }

  // One side conversation per parent, so the type is single-instance: opening
  // again reveals the existing tab rather than stacking a second one. The guide
  // entry is how the type appears among the sidebar's own choices.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID,
    kind: 'side-chat',
    title: () => t('title'),
    guide: [{
      id: 'side-chat',
      order: 30,
      title: () => t('open'),
      description: () => t('openHint'),
    }],
  }), 'ui-side-chat.type')

  // Closing the tab is what ends the side conversation. The handler must not
  // throw: a failed close leaves the child running, which the tab body still
  // shows, so a rejection here would only lose the reader's tab.
  ctx.effect(() => ctx.sidebarRight.registerCloseHandler('side-chat', (sessionId, tab) => {
    generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1)
    const params = ctx.sidebarRight.tabDomain.occurrence(sessionId, { id: tab.id })
      .navigation.getSnapshot().params
    if (params === undefined || !('sideChatId' in params)) return
    if (typeof params.sideChatId !== 'string') return
    void ctx.sideChatClient.close(params.sideChatId).catch((error: unknown) => {
      controller.state.update(state => { state[sessionId] = { ...state[sessionId], error: String(error) } })
    })
  }), 'ui-side-chat.close')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: NS,
    inject: (sessionId: SessionId): SideChatBodyInjected => ({
      sessionId,
      hooks: { sideChatState: controller.state, busyEnter },
      watch: parent => controller.acquire(parent),
      send: (child, content, mode) => ctx.sideChatClient.send(child, content, mode),
      upload: (child, part) => ctx.sideChatClient.upload(child, part),
      updateQueue,
      imageUrl,
      queueT,
      stop,
      openSideChat,
    }),
  }, SideChatBody)), 'ui-side-chat.body')

  // The header action is how a side conversation starts beside a session. It
  // sits with the session's other header utilities so it reads as an action on
  // the session rather than on the sidebar.
  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: PLUGIN_ID,
    locale: NS,
    inject: (sessionId: SessionId): SideChatOpenActionInjected => ({
      parentSessionId: sessionId,
      openSideChat,
    }),
  }, SideChatOpenAction)), 'ui-side-chat.open-action')
}

export type { SideChatKey }
