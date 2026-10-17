// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideChatBodyInjected, SideChatOpenActionInjected } from '../src/client/contract.ts'
import { Config, apply } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); vi.restoreAllMocks() })

function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const register = vi.fn((_options: { inject?: (id: SessionId) => object }, _component: object) => () => {})
  ctx.provide('slots', { inject: (_seat: string, callback: () => () => void) => callback(), register } as never)
  const type = vi.fn((_definition: { title: () => string; guide: { title: () => string; description: () => string }[] }) => () => {})
  ctx.provide('sidebarRightTabs', { register: type } as never)
  const navigation = { params: undefined as Record<string, unknown> | undefined }
  const closeHandler = vi.fn((_kind: string, _callback: Parameters<Context['sidebarRight']['registerCloseHandler']>[1]) => () => {})
  const openTabIn = vi.fn()
  ctx.provide('sidebarRight', { openTabIn, registerCloseHandler: closeHandler,
    tabDomain: { occurrence: () => ({ navigation: { getSnapshot: () => navigation } }) } } as never)
  const side = { find: vi.fn(), open: vi.fn(), close: vi.fn().mockResolvedValue(true), read: vi.fn().mockResolvedValue({}),
    send: vi.fn(), upload: vi.fn(), readAttachment: vi.fn().mockResolvedValue({ mediaType: 'image/png', data: 'bytes' }) }
  ctx.provide('sideChatClient', side as never)
  const session = { cancel: vi.fn(), updateQueue: vi.fn() }
  ctx.provide('remote', { session } as never)
  const preference = createSnapshotStore<{ value?: { busyEnter?: 'queue' | 'steer' } }>({})
  ctx.provide('configForms', { get: () => preference } as never)
  apply(ctx, Config.parse({}))
  const body = register.mock.calls[0]![0].inject!('parent' as SessionId) as SideChatBodyInjected
  const action = register.mock.calls[1]![0].inject!('parent' as SessionId) as SideChatOpenActionInjected
  const close = () =>{  closeHandler.mock.calls[0]![1]('parent' as SessionId, { id: 'tab' } as never) }
  return { ctx, type, navigation, side, session, preference, body, action, close, openTabIn }
}

it('registers localized entry points and adopts the shared preference', async () => {
  hostApply()
  const test = bench()
  const definition = test.type.mock.calls[0]![0]
  expect(definition.title()).toBe('Side chat')
  expect(definition.guide[0]!.title()).toBe('Side chat')
  expect(definition.guide[0]!.description()).toBeTruthy()
  expect(test.body.hooks.busyEnter.getSnapshot()).toBe('queue')
  test.preference.set({ value: { busyEnter: 'steer' } })
  expect(test.body.hooks.busyEnter.getSnapshot()).toBe('steer')
  const release = test.body.watch('parent')
  await vi.waitFor(() => { expect(test.side.read).toHaveBeenCalledWith('parent') })
  release()
  await test.body.send('child', [], 'queue')
  await test.body.upload('child', { type: 'file', name: 'x', data: 'eA==' })
  expect(await test.body.imageUrl('child', { attachmentId: 'img' } as never)).toBe('data:image/png;base64,bytes')
  test.session.cancel.mockResolvedValueOnce({ ok: false, error: { message: 'cancel refused' } }).mockResolvedValueOnce({ ok: true, value: { accepted: true } })
  await expect(test.body.stop('child')).rejects.toThrow('cancel refused')
  expect(await test.body.stop('child')).toBe(true)
  test.session.updateQueue.mockResolvedValueOnce({ ok: false, error: { message: 'edit refused' } }).mockResolvedValueOnce({ ok: true })
  await expect(test.body.updateQueue('child', 'item' as never, { kind: 'remove' })).rejects.toThrow('edit refused')
  await test.body.updateQueue('child', 'item' as never, { kind: 'remove' })
})

it('reveals an existing child, opens new children, and preserves refusals', async () => {
  const test = bench()
  test.side.find.mockResolvedValueOnce({ sessionId: 'existing' })
  expect(await test.action.openSideChat('parent')).toEqual({ ok: true, sideChatId: 'existing' })
  test.side.open.mockResolvedValueOnce({ ok: false, message: 'no history' }).mockResolvedValueOnce({ ok: true, sideChat: { sessionId: 'new' } })
  expect(await test.action.openSideChat('parent')).toEqual({ ok: false, message: 'no history' })
  expect(await test.action.openSideChat('parent')).toEqual({ ok: true, sideChatId: 'new' })
  expect(test.openTabIn).toHaveBeenLastCalledWith('parent', 'side-chat', { params: { sideChatId: 'new' } })
})

it('invalidates in-flight opens when the tab closes and closes any late child', async () => {
  const test = bench()
  const finding = Promise.withResolvers<undefined>()
  test.side.find.mockReturnValueOnce(finding.promise)
  const first = test.action.openSideChat('parent')
  test.close()
  finding.resolve(undefined)
  expect(await first).toMatchObject({ ok: false })
  const opening = Promise.withResolvers<{ ok: true; sideChat: { sessionId: string } }>()
  test.side.open.mockReturnValueOnce(opening.promise)
  const second = test.action.openSideChat('parent')
  await vi.waitFor(() => { expect(test.side.open).toHaveBeenCalledOnce() })
  test.navigation.params = {}
  test.close()
  opening.resolve({ ok: true, sideChat: { sessionId: 'late' } })
  expect(await second).toMatchObject({ ok: false })
  expect(test.side.close).toHaveBeenCalledWith('late')
  test.navigation.params = { sideChatId: 42 }
  test.close()
  test.navigation.params = { sideChatId: 'child' }
  test.side.close.mockRejectedValueOnce(new Error('close failed'))
  test.close()
  await vi.waitFor(() => { expect(test.body.hooks.sideChatState.getSnapshot().parent?.error).toContain('close failed') })
})
