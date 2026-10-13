// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileBase64 } from '../src/read-file-base64.ts'
import { queueStripBlocks, queueRowPresentation } from '../src/queue-row.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('attachment input', () => {
  it('reads browser file bytes without the data URL prefix', async () => {
    expect(await readFileBase64(new File(['hello'], 'hello.txt', { type: 'text/plain' }))).toBe('aGVsbG8=')
  })

  it.each([new DOMException('unreadable'), null])('rejects unreadable files with the reader failure or a fallback', async (error) => {
    class FailedReader {
      readonly error = error
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onerror?.() }
    }
    vi.stubGlobal('FileReader', FailedReader)
    await expect(readFileBase64(new File([], 'broken'))).rejects.toThrow(error?.message ?? 'attachment read failed')
  })

  it('describes malformed and future queue content without allowing text-only edits', () => {
    expect(queueRowPresentation([null, { type: 'future' }, { type: 'text' }])).toEqual({ preview: '[undefined] [future] [text]', text: null })
  })

  const image = { attachmentId: 'image', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
  const file = { attachmentId: 'file', name: 'notes.txt', bytes: 5 }

  it('preserves valid image and file references and ignores unknown wire blocks', () => {
    expect(queueStripBlocks([null, [], { type: 'text', text: '' }, { type: 'text', text: 1 },
      { type: 'future' }, { type: 'text', text: 'question' },
      { type: 'image', attachment: image }, { type: 'file', attachment: file }])).toEqual([
      { type: 'text', text: 'question' }, { type: 'image', attachment: image }, { type: 'file', attachment: file },
    ])
  })

  it.each(Object.keys(image))('omits an image with an invalid %s', (key) => {
    expect(queueStripBlocks([{ type: 'image', attachment: { ...image, [key]: null } }])).toEqual([])
  })

  it.each(Object.keys(file))('omits a file with an invalid %s', (key) => {
    expect(queueStripBlocks([{ type: 'file', attachment: { ...file, [key]: null } }])).toEqual([])
  })

  it.each(['image', 'file'])('omits a %s without an attachment object', (type) => {
    expect(queueStripBlocks([{ type }, { type, attachment: [] }])).toEqual([])
  })
})
