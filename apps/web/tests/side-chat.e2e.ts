import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { captureStableAria, launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'
import type {} from '@deepseek-ai/dsh-side-chat'

const fixture = createChatScrollFixture({ markerPrefix: 'SIDE_PARENT', title: 'SIDE_PARENT history', turns: 2 })
let directory: string
let scaffold: WebScaffold
let browser: Browser
let page: Page
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-side-chat-e2e-'))
  const override = join(directory, 'replay.json')
  await writeFile(override, JSON.stringify([
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'SIDE_REPLY: I can explain the parent without changing it.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'SIDE_REPLY: I can explain the parent without changing it.' } },
      { type: 'usage', usage: { inputTokens: 32, outputTokens: 16 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
    // The stopped turn: it streams a partial line and then stalls until the Stop
    // control cancels it, so the reply never completes on its own.
    { kind: 'hang' },
  ]))
  scaffold = await launchWebScaffold({ replayFixture: join(directory, 'override-only.jsonl'), replayOverride: override, paceMs: 5 })
  await seedSession(scaffold, fixture.log, 'side-parent-e2e')
  const executablePath = process.env.DSH_TEST_CHROMIUM
  browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
  page = await newEnglishPage(browser, 1200)
  await page.goto(scaffold.authenticatedUrl)
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(fixture.markers.user(1))
  await page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').first().click()
  await page.getByText(fixture.markers.assistant(2), { exact: false }).last().waitFor()
}, 120_000)
afterAll(async () => {
  await browser?.close()
  try { await scaffold?.close() }
  finally { if (directory) await rm(directory, { recursive: true, force: true }) }
})
it('opens, sends, and displays a child-only transcript', async () => {
  onTestFailed(async () => { await writeFile('/tmp/dsh-side-e2e-failure.txt', await page.locator('body').ariaSnapshot()) })
  await page.getByRole('button', { name: 'Side chat', exact: true }).click()
  const panel = page.locator('[data-side-chat]')
  await panel.getByRole('textbox').fill('Explain the parent task without changing any files.')
  await panel.getByRole('button', { name: 'Send', exact: true }).click()
  await panel.getByText('SIDE_REPLY:', { exact: false }).waitFor({ timeout: 30_000 })
  expect(await panel.textContent()).not.toContain(fixture.markers.assistant(1))
  expect(await captureStableAria(page, '[data-side-chat]', scaffold.workspaceCwd)).toMatchSnapshot()
  const childId = await panel.getAttribute('data-side-chat-id')
  expect(childId).toBeTruthy()
  // The Host and browser share the shipped Loader composition; the child has no stored log.
  const side = scaffold.ctx.sideChat.listOpen()[0]
  if (!side) throw new Error('side chat missing')
  await expect(scaffold.ctx.sessionPersistence.open(side.sessionId, 'read')).rejects.toThrow()
  expect(await page.getByText(fixture.markers.assistant(2), { exact: false }).count()).toBeGreaterThan(0)
})

it('stops a running reply without discarding the child, and close still discards it', async () => {
  onTestFailed(async () => { await writeFile('/tmp/dsh-side-e2e-stop-failure.txt', await page.locator('body').ariaSnapshot()) })
  const panel = page.locator('[data-side-chat]')
  const childId = await panel.getAttribute('data-side-chat-id')

  // The second question consumes the stalled entry: only Stop can end this turn.
  await panel.getByRole('textbox').fill('Keep going until I stop you.')
  await panel.getByRole('button', { name: 'Send', exact: true }).click()
  const stop = panel.getByRole('button', { name: 'Stop', exact: true })
  await stop.waitFor({ timeout: 30_000 })

  // An attached file is admitted against this conversation and rides the
  // question through the shared queue strip.
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello'),
  })
  await expect.poll(() => panel.getByText('notes.txt').count()).toBeGreaterThan(0)

  // A question submitted while the child replies is queued, not refused, and it
  // is visible while it waits — the main composer's busy behaviour.
  await panel.getByRole('textbox').fill('Ask this one next.')
  await panel.getByRole('button', { name: 'Queue message', exact: true }).click()
  // The waiting question renders through the shared queue strip, carrying its
  // attachment and the same operations the main composer offers.
  const queued = panel.locator('[data-queue-dock]')
  await expect.poll(async () => await queued.textContent()).toContain('Ask this one next.')
  await expect.poll(async () => await queued.textContent()).toContain('notes.txt')
  expect(await queued.getByRole('button', { name: 'Remove queued message' }).count()).toBe(1)
  expect(await queued.getByRole('button', { name: 'Steer queued message' }).count()).toBe(1)

  await stop.click()
  // The polled snapshot clears `running`, which is what retires the control.
  await stop.waitFor({ state: 'detached', timeout: 30_000 })

  // Stopping cancelled the turn, not the conversation: same child, still open,
  // still able to take a follow-up.
  expect(await panel.getAttribute('data-side-chat-id')).toBe(childId)
  expect(scaffold.ctx.sideChat.listOpen()).toHaveLength(1)
  await panel.getByRole('textbox').fill('Still there?')
  expect(await panel.getByRole('button', { name: 'Send', exact: true }).isEnabled()).toBe(true)

  await page.getByRole('tab', { name: 'Side chat Close', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => scaffold.ctx.sideChat.listOpen().length).toBe(0)
})
