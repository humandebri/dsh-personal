import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { SideChatClient, apply } from '../src/client/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

it('projects transport and business results without exposing the Remote envelope', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const remote = { open: vi.fn(), list: vi.fn(), send: vi.fn(), upload: vi.fn(), attachment: vi.fn(), close: vi.fn() }
  ctx.provide('remote', { sideChat: remote } as never)
  apply(ctx)
  const client = ctx.sideChatClient
  expect(client).toBeInstanceOf(SideChatClient)
  const sideChat = { sessionId: 'child', parentSessionId: 'parent' }
  const wireFailure = { ok: false, error: { message: 'transport refused' } }
  remote.open.mockResolvedValueOnce({ ok: true, value: { ok: true, sideChat } })
  expect(await client.open('parent')).toEqual({ ok: true, sideChat })
  remote.open.mockResolvedValueOnce({ ok: true, value: { ok: false, reason: 'already-open', message: 'exists' } })
  expect(await client.open('parent')).toEqual({ ok: false, reason: 'already-open', message: 'exists' })
  remote.open.mockResolvedValueOnce(wireFailure)
  expect(await client.open('parent')).toMatchObject({ ok: false, message: 'transport refused' })
  remote.open.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce({ isDSHRemoteError: true, code: 'offline', message: 'structured offline' })
  expect(await client.open('parent')).toMatchObject({ ok: false, message: 'Error: offline' })
  expect((await client.open('parent')).ok).toBe(false)
  remote.list.mockResolvedValueOnce(wireFailure).mockResolvedValueOnce({ ok: true, value: { sideChat } })
  await expect(client.read('parent')).rejects.toThrow('transport refused')
  expect(await client.read('parent')).toEqual({ sideChat })
  remote.list.mockResolvedValueOnce(wireFailure).mockResolvedValueOnce({ ok: true, value: { sideChat } })
  expect(await client.find('parent')).toBeUndefined()
  expect(await client.find('parent')).toEqual(sideChat)
  remote.close.mockResolvedValueOnce(wireFailure).mockResolvedValueOnce({ ok: true, value: { closed: true } })
  expect(await client.close('child')).toBe(false)
  expect(await client.close('child')).toBe(true)
  for (const method of ['send', 'upload', 'attachment'] as const) {
    const invoke = () => method === 'send' ? client.send('child', [])
      : method === 'upload' ? client.upload('child', { type: 'file', name: 'x', data: 'eA==' })
        : client.readAttachment('child', 'image')
    remote[method].mockResolvedValueOnce(wireFailure).mockResolvedValueOnce({ ok: true, value: { ok: false, message: 'business refusal' } })
    await expect(invoke()).rejects.toThrow('transport refused')
    await expect(invoke()).rejects.toThrow('business refusal')
  }
  remote.send.mockResolvedValue({ ok: true, value: { ok: true } })
  await client.send('child', [], 'steer')
  expect(remote.send).toHaveBeenLastCalledWith({ sessionId: 'child', content: [], mode: 'steer' })
  const block = { type: 'file', attachment: { attachmentId: 'file', name: 'x', bytes: 1 } }
  remote.upload.mockResolvedValue({ ok: true, value: { ok: true, block } })
  expect(await client.upload('child', { type: 'file', name: 'x', data: 'eA==' })).toEqual(block)
  remote.attachment.mockResolvedValue({ ok: true, value: { ok: true, mediaType: 'image/png', data: 'bytes' } })
  expect(await client.readAttachment('child', 'image')).toEqual({ mediaType: 'image/png', data: 'bytes' })
})
