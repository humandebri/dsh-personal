// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  SideChatContentBlock,
  SideChatDeliveryMode,
  SideChatListValue,
  SideChatQueuedItem,
  SideChatUploadPart,
} from '@deepseek-ai/dsh-side-chat/types'
import { SideChatBody, type SideChatBodyProps } from '../src/client/SideChatBody.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** What one mount varies: the Host calls, the reply state, and the shared preference. */
interface MountOptions {
  readonly send?: (child: string, content: readonly SideChatContentBlock[], mode: SideChatDeliveryMode) => Promise<void>
  readonly stop?: (child: string) => Promise<boolean>
  readonly upload?: SideChatBodyProps['upload']
  readonly updateQueue?: SideChatBodyProps['updateQueue']
  readonly running?: boolean
  readonly busyEnter?: SideChatDeliveryMode
  readonly pending?: readonly SideChatQueuedItem[]
}

/** The shared queue strip's copy, keyed like the conversation dictionary. */
const queueT = ((key: string, params?: Record<string, unknown>) => (
  params === undefined ? key : `${key}:${JSON.stringify(params)}`
)) as unknown as SideChatBodyProps['queueT']

function mount(options: MountOptions = {}) {
  const send = options.send ?? vi.fn(async () => {})
  const stop = options.stop ?? vi.fn(async () => true)
  const upload: SideChatBodyProps['upload'] = options.upload ?? vi.fn(async (_child: string, part: SideChatUploadPart) => (
    part.type === 'image'
      ? { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } }
      : { type: 'file', attachment: { attachmentId: 'file-1', name: 'notes.txt', bytes: 5 } }
  ) as SideChatContentBlock)
  const updateQueue: SideChatBodyProps['updateQueue'] = options.updateQueue ?? vi.fn(async () => {})
  const state = createSnapshotStore<Record<string, SideChatListValue>>({ parent: {
    sideChat: { sessionId: 'child', parentSessionId: 'parent' },
    snapshot: {
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'A real reply' }] }],
      running: options.running ?? false,
      pending: options.pending ?? [],
    },
  } })
  const busyEnter = createSnapshotStore<SideChatDeliveryMode>(options.busyEnter ?? 'queue')
  const release = vi.fn()
  // This component consumes only the tab and transcript seats, not the other owner hooks.
  const props = {
    sessionId: 'parent',
    useTabInfo: () => ({ tab: { navigation: { params: { sideChatId: 'child' } } } }),
    useSideChatState: bindSnapshotSelector(state),
    useBusyEnter: bindSnapshotSelector(busyEnter),
    watch: () => release,
    send,
    upload,
    updateQueue,
    imageUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
    queueT,
    stop,
    openSideChat: vi.fn(),
    t: makeTranslate(en),
  } as unknown as SideChatBodyProps
  const rendered = render(<SideChatBody {...props} />)
  return { send, upload, updateQueue, stop, release, ...rendered }
}

/** One waiting question, as the Host reports it. */
function waiting(id: string, text: string): SideChatQueuedItem {
  return { id, placement: 'queued', message: { id, content: [{ type: 'text', text }] } }
}

describe('side chat body', () => {
  it('renders replies and sends to the child before clearing the draft', async () => {
    const test = mount()
    expect(screen.getByText('A real reply')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(test.send).toHaveBeenCalledWith(
      'child', [{ type: 'text', text: 'Explain it' }], 'queue',
    ))
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''))
    test.unmount()
    expect(test.release).toHaveBeenCalledOnce()
  })
  it('keeps the draft and displays a rejected send', async () => {
    const test = mount({ send: vi.fn(async () => { throw new Error('offline') }) })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('offline'))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep me')
    test.unmount()
  })
  it('submits the draft on plain Enter', async () => {
    const test = mount()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Plain question' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => {
      expect(test.send).toHaveBeenCalledWith('child', [{ type: 'text', text: 'Plain question' }], 'queue')
    })
    test.unmount()
  })
  it('keeps Shift+Enter and a held-down Enter for the text', () => {
    const test = mount()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Two lines' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', repeat: true })
    expect(test.send).not.toHaveBeenCalled()
    test.unmount()
  })
  it('leaves composition Enter to the IME: composing, late Safari keydown, and keyCode 229', () => {
    // Fake timers mock Date too, which is what the post-compositionEnd window reads.
    vi.useFakeTimers()
    try {
      const test = mount()
      const box = screen.getByRole('textbox')
      fireEvent.change(box, { target: { value: '日本語' } })
      fireEvent.compositionStart(box)
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(test.send).not.toHaveBeenCalled()
      // Safari delivers the closing keydown AFTER compositionend.
      fireEvent.compositionEnd(box)
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(test.send).not.toHaveBeenCalled()
      vi.advanceTimersByTime(20)
      // The legacy signal engines emit without isComposing.
      fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
      expect(test.send).not.toHaveBeenCalled()
      // The conversion-confirming Enter is over; the next one is a real submit.
      fireEvent.keyDown(box, { key: 'Enter' })
      expect(test.send).toHaveBeenCalledTimes(1)
      test.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
  it('keeps plain Enter for the text on a touch device and submits with the chord', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    onTestFinished(() => {
      if (original === undefined) Reflect.deleteProperty(window, 'matchMedia')
      else Object.defineProperty(window, 'matchMedia', original)
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: query === '(pointer: coarse)', media: query }),
    })
    const test = mount()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '日本語の下書き' } })
    // The software keyboard's Return is the only newline, so it never submits.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(test.send).not.toHaveBeenCalled()
    // The accelerated chord stays a deliberate submit for a hardware keyboard.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
    await waitFor(() => {
      expect(test.send).toHaveBeenCalledWith('child', [{ type: 'text', text: '日本語の下書き' }], 'queue')
    })
    test.unmount()
  })
  it('offers Stop only while a reply runs and cancels that child', async () => {
    const test = mount({ running: true })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(test.stop).toHaveBeenCalledWith('child'))
    test.unmount()
  })
  it('accepts a question while the child replies, delivering it as the preference says', async () => {
    const test = mount({ running: true })
    // The button names what Enter would deliver, and stays available: a queued
    // question waits for the next turn instead of being refused.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'And what about the schema?' } })
    const queue = screen.getByRole('button', { name: 'Queue message' })
    expect((queue as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(queue)
    await waitFor(() => expect(test.send).toHaveBeenCalledWith(
      'child', [{ type: 'text', text: 'And what about the schema?' }], 'queue',
    ))
    test.unmount()
  })
  it('delivers the accelerated chord as the opposite of the preference', async () => {
    const test = mount({ running: true })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Stop and read this' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(test.send).toHaveBeenCalledWith(
      'child', [{ type: 'text', text: 'Stop and read this' }], 'steer',
    ))
    test.unmount()
  })
  it('follows a steer preference with plain Enter and queues on the chord', async () => {
    const test = mount({ running: true, busyEnter: 'steer' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Interrupt please' } })
    fireEvent.click(screen.getByRole('button', { name: 'Steer message' }))
    await waitFor(() => expect(test.send).toHaveBeenCalledWith(
      'child', [{ type: 'text', text: 'Interrupt please' }], 'steer',
    ))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Wait your turn' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(test.send).toHaveBeenCalledWith(
      'child', [{ type: 'text', text: 'Wait your turn' }], 'queue',
    ))
    test.unmount()
  })
  it('renders waiting questions through the shared queue strip', async () => {
    const test = mount({ running: true, pending: [waiting('i-1', 'queued while replying')] })
    expect(screen.getByText('queued while replying')).toBeDefined()
    // The shared strip's own operations mutate through the injected queue verb.
    fireEvent.click(screen.getByLabelText('queue.remove'))
    await waitFor(() => expect(test.updateQueue).toHaveBeenCalledWith('child', 'i-1', { kind: 'remove' }))
    test.unmount()
  })
  it('shows no queue strip while nothing waits', () => {
    const test = mount()
    expect(screen.queryByText('queued while replying')).toBeNull()
    expect(screen.queryByLabelText('queue.remove')).toBeNull()
    test.unmount()
  })
  it('stages an attached file, then submits it with the question', async () => {
    const test = mount()
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    // The native picker is visually hidden chrome, so the spec drives it directly.
    fireEvent.change(test.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    await waitFor(() => expect(test.upload).toHaveBeenCalledWith('child', {
      type: 'file', data: btoa('hello'), name: 'notes.txt',
    }))
    await waitFor(() => expect(screen.getByText('notes.txt')).toBeDefined())
    expect(screen.getByText(/5/)).toBeDefined()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'What is in this?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(test.send).toHaveBeenCalledWith('child', [
      { type: 'text', text: 'What is in this?' },
      { type: 'file', attachment: { attachmentId: 'file-1', name: 'notes.txt', bytes: 5 } },
    ], 'queue'))
    // The draft and its chip are released once the question is admitted.
    await waitFor(() => expect(screen.queryByText('notes.txt')).toBeNull())
    test.unmount()
  })
  it('stages files dropped on the panel and pasted into the composer', async () => {
    const test = mount()
    const dropped = new File(['drop'], 'dropped.txt', { type: 'text/plain' })
    fireEvent.drop(document.querySelector('[data-side-chat]') as HTMLElement, { dataTransfer: { files: [dropped] } })
    await waitFor(() => expect(screen.getByText('dropped.txt')).toBeDefined())

    const pasted = new File(['paste'], 'pasted.txt', { type: 'text/plain' })
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [pasted] } })
    await waitFor(() => expect(screen.getByText('pasted.txt')).toBeDefined())
    // The chip appears at staging; the admission call follows the byte read.
    await waitFor(() => expect(test.upload).toHaveBeenCalledTimes(2))
    test.unmount()
  })
  it('keeps a failed attachment beside the draft with its refusal', async () => {
    const test = mount({ upload: vi.fn(async () => { throw new Error('too large') }) })
    const file = new File(['x'], 'big.bin', { type: 'application/octet-stream' })
    // The native picker is visually hidden chrome, so the spec drives it directly.
    fireEvent.change(test.container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText(/too large/)).toBeDefined())
    // Nothing to upload means nothing to send.
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    test.unmount()
  })
  it('omits Stop once the child is idle', () => {
    const test = mount()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    test.unmount()
  })
  it('displays a rejected stop instead of leaving the reply silently running', async () => {
    const test = mount({ running: true, stop: vi.fn(async () => { throw new Error('stop refused') }) })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('stop refused'))
    test.unmount()
  })
})
