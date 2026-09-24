import { afterEach, describe, expect, it, vi } from 'vitest'
import { SideChatController } from '../src/client/controller.ts'
import type { SideChatClient } from '@deepseek-ai/dsh-side-chat/client'

afterEach(() => vi.useRealTimers())
describe('side chat polling lifecycle', () => {
  it('publishes replies and stops reads when the last tab releases', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => ({ sideChat: { sessionId: 'child', parentSessionId: 'parent' } }))
    const controller = new SideChatController({ read } as Pick<SideChatClient, 'read'>, 1000)
    const release = controller.acquire('parent')
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.state.getSnapshot().parent?.sideChat?.sessionId).toBe('child')
    release()
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledOnce()
    controller.dispose()
  })
  it('does not publish a late response after disposal', async () => {
    let finish!: (value: {}) => void
    const read = vi.fn(() => new Promise<{}>(resolve => { finish = resolve }))
    const controller = new SideChatController({ read }, 1000)
    controller.acquire('parent')
    controller.dispose()
    finish({})
    await Promise.resolve()
    expect(controller.state.getSnapshot()).toEqual({})
  })
})
