// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueueStrip, type QueueStripRow } from '../src/QueueStrip.tsx'

afterEach(cleanup)
const rows: QueueStripRow[] = [
  { kind: 'waiting', id: 'first', content: [{ type: 'text', text: 'first question' }] },
  { kind: 'waiting', id: 'second', content: [{ type: 'text', text: 'second question' }] },
]
const t = (key: string): string => key

describe('queue strip transitions', () => {
  it('retires editing when a row becomes an echo or mutations stop, and restores collapsed empty state', () => {
    const props = { rows, running: true, mutable: true, updateQueue: vi.fn(async () => {}), notify: vi.fn(), t }
    const view = render(<QueueStrip {...props} />)
    fireEvent.click(view.getByRole('button', { name: 'queue.count' }))
    fireEvent.click(view.getAllByRole('button', { name: 'queue.edit' })[0]!)
    view.rerender(<QueueStrip {...props} rows={[{ kind: 'echo', id: 'first', text: 'submitted', attachments: [] }]} />)
    expect(view.queryByRole('textbox')).toBeNull()
    view.rerender(<QueueStrip {...props} rows={rows.slice(0, 1)} />)
    fireEvent.click(view.getByRole('button', { name: 'queue.edit' }))
    view.rerender(<QueueStrip {...props} mutable={false} />)
    expect(view.queryByRole('textbox')).toBeNull()
    view.rerender(<QueueStrip {...props} rows={[]} />)
    view.rerender(<QueueStrip {...props} />)
    expect(view.getByRole('button', { name: 'queue.count' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('rejects blank edits, preserves a failed edit and retries with the Save button', async () => {
    const updateQueue = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const notify = vi.fn()
    const view = render(<QueueStrip rows={rows.slice(0, 1)} running mutable updateQueue={updateQueue} notify={notify} t={t} />)
    fireEvent.click(view.getByRole('button', { name: 'queue.edit' }))
    fireEvent.change(view.getByRole('textbox'), { target: { value: '  ' } })
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' })
    expect(updateQueue).not.toHaveBeenCalled()
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'corrected question' } })
    fireEvent.click(view.getByRole('button', { name: 'queue.save' }))
    await waitFor(() => { expect(notify).toHaveBeenCalledWith('error', 'queue.editFailed') })
    expect(view.getByRole('textbox')).toHaveProperty('value', 'corrected question')
    fireEvent.click(view.getByRole('button', { name: 'queue.save' }))
    await waitFor(() => { expect(view.queryByRole('textbox')).toBeNull() })
    expect(updateQueue).toHaveBeenLastCalledWith('first', { kind: 'edit', content: [{ type: 'text', text: 'corrected question' }] })
  })

  it('does not submit duplicate edits when Enter is repeated during an in-flight save', async () => {
    const gate = Promise.withResolvers<undefined>()
    const updateQueue = vi.fn(() => gate.promise)
    const view = render(<QueueStrip rows={rows.slice(0, 1)} running mutable updateQueue={updateQueue} notify={vi.fn()} t={t} />)
    fireEvent.click(view.getByRole('button', { name: 'queue.edit' }))
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' })
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' })
    expect(updateQueue).toHaveBeenCalledTimes(1)
    gate.resolve(undefined)
    await waitFor(() => { expect(view.queryByRole('textbox')).toBeNull() })
  })
})
