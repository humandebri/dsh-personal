/** Real Loader/Web navigation keeps recent transcripts without opening history again. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))

it.each([false, true])('reuses recent history, draft and image cache (long history: %s)', async (longHistory) => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const controller: SessionController = scaffold.ctx.sessionController
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  let seed = await readFile(SEED, 'utf8')
  if (longHistory) {
    const [image] = await scaffold.ctx.attachments.saveImages([{
      mediaType: 'image/png',
      data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      name: 'retained-image.png',
    }])
    seed = seed.split('\n').map((line) => {
      if (line === '') return line
      const record = JSON.parse(line) as { type?: string; data?: { content: unknown[] } }
      if (record.type === 'user/message' && record.data !== undefined) {
        record.data.content = [
          { type: 'text', text: Array.from({ length: 120 }, (_unused, index) => `Retained history line ${index + 1}`).join('\n') },
          { type: 'image', attachment: image },
        ]
      }
      return JSON.stringify(record)
    }).join('\n')
  }
  const ids = await Promise.all(['a', 'b'].map(async (name) => {
    const id = await seedSession(scaffold, seed, `recent-conversation-${name}`)
    await workspace.attachSession(id)
    await controller.rename({ sessionId: id, title: `Recent conversation ${name}` })
    return id
  }))
  const follow = vi.spyOn(controller, 'follow')
  onTestFinished(() => { follow.mockRestore() })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const console = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const row = (name: string) => page.getByRole('treeitem').filter({
    has: page.getByText(`Recent conversation ${name}`, { exact: true }),
  })
  const transcript = page.locator('[data-phase="active"]').first()
  await row('a').click()
  await transcript.getByText('DONE', { exact: true }).waitFor()
  const input = page.locator('[data-composer-input][contenteditable="true"]').first()
  await input.fill('Retained conversation draft')
  const image = page.locator('[data-message-attachments] img').first()
  let imageUrl: string | null = null
  if (longHistory) {
    await page.locator('[data-conversation-scroll]').evaluate((element) => { element.scrollTop = 0 })
    await expect.poll(() => image.isVisible()).toBe(true)
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1)
    imageUrl = await image.getAttribute('src')
  }
  const scroll = page.locator('[data-conversation-scroll]')
  const scrollTop = await scroll.evaluate(element => element.scrollTop)
  await row('b').click()
  await transcript.getByText('DONE', { exact: true }).waitFor()
  const openedA = () => follow.mock.calls.filter(([request]) =>
    request.address.kind === 'session' && request.address.sessionId === ids[0]).length
  const before = openedA()
  await page.evaluate(() => {
    document.documentElement.dataset.recentSettling = 'false'
    new MutationObserver(() => {
      if (document.querySelector('[data-phase="settling"]') !== null) {
        document.documentElement.dataset.recentSettling = 'true'
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] })
  })
  const started = performance.now()
  await row('a').click()
  await expect.poll(() => input.innerText()).toBe('Retained conversation draft')
  if (longHistory) {
    await expect.poll(() => image.isVisible()).toBe(true)
    expect(await image.getAttribute('src')).toBe(imageUrl)
  } else {
    await transcript.getByText('DONE', { exact: true }).waitFor()
  }
  await expect.poll(async () => Math.abs(await scroll.evaluate(element => element.scrollTop) - scrollTop)).toBeLessThan(2)
  const after = openedA()
  process.stdout.write(`Recent conversation A→B→A: history opens ${before}→${after}, return ${Math.round(performance.now() - started)}ms\n`)
  expect(after).toBe(before)
  expect(await page.evaluate(() => document.documentElement.dataset.recentSettling)).toBe('false')
  expect(console.pageErrors).toEqual([])
}, 120_000)
