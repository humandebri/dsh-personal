import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-user-approval'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/approval-composer/session.v3.jsonl', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/auto-review-wait/panel.expected.md', import.meta.url))

it('keeps a failed review pending through retry and reconnect, then executes once', async () => {
  const scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false })
  const executablePath = process.env.DSH_TEST_CHROMIUM_EXECUTABLE
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
  try {
    // Exercise the real approval transport with an offline reviewer outcome;
    // the shell action and its replayed main-agent turn remain unchanged.
    const original = scaffold.ctx.approval.request.bind(scaffold.ctx.approval)
    let retries = 0
    vi.spyOn(scaffold.ctx.approval, 'request').mockImplementation(req => original({
      ...req, waitForAnswerer: true, retryable: true,
      reason: 'Automatic review could not complete. Retry or decide this action.',
      onRetry: async () => {
        retries += 1
        return { kind: 'ask', reason: 'This action requires your approval.', retryable: false }
      },
    }))
    const page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.locator('[aria-label^="Access mode"]').click()
    await page.getByRole('menuitem', { name: 'Read Only' }).click()
    await expect.poll(() => page.locator('[aria-label="Access mode, current: Read Only"]').count()).toBe(1)
    const settled = scaffold.whenTurnSettled(120_000)
    const input = page.locator('[data-composer-input]').first()
    await input.fill(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))[0]!)
    await input.press('Enter')
    const panel = page.locator('[data-approval-key]')
    await panel.waitFor({ timeout: 60_000 })
    await compareOrRefreshGolden(EXPECTED,
      await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd), webSnapshotMode())
    await panel.getByRole('button', { name: 'Retry review' }).click()
    await expect.poll(() => retries).toBe(1)
    await panel.getByText('This action requires your approval.', { exact: true }).waitFor()
    await expect(readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'))).rejects.toThrow()
    await page.reload({ waitUntil: 'load' })
    await panel.waitFor({ timeout: 30_000 })
    await panel.getByRole('button', { name: 'Allow once' }).click()
    const sessionId = await settled
    const session = scaffold.ctx.sessions.get(sessionId)!
    const approvals = session.snapshotEvents().filter(event => event.type === 'approval/decided')
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.data).toMatchObject({ outcome: 'allowed-once' })
    expect(await readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')).toContain('tok')
  } finally {
    vi.restoreAllMocks()
    await browser.close()
    await scaffold.close()
  }
}, 180_000)
