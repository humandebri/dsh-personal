/** Host half: live config validation and index boot rows. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import * as HostPlugin from '../src/index.ts'
import { Config, apply } from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'

function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

function scriptText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script') throw new Error('expected a script row')
  return row.text
}

describe('ui-font-family host', () => {
  it('validates and updates the live font preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    expect(plainConfig(configuration.fiber.config)).toEqual({ fontFamily: '' })
    await configuration.update({ fontFamily: '"Hiragino Sans", sans-serif' })
    expect(plainConfig(configuration.fiber.config)).toEqual({ fontFamily: '"Hiragino Sans", sans-serif' })
    await expect(configuration.update({ fontFamily: 'broken ; value' })).rejects.toThrow()
    await expect(configuration.update({ fontFamily: 'x'.repeat(257) })).rejects.toThrow()
    await configuration.fiber.dispose()
  })

  it('bootstraps the chosen family and drops the row when cleared', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    expect(collect(ctx)).toEqual([])
    await configuration.update({ fontFamily: '"Hiragino Sans", sans-serif' })
    const rows = collect(ctx)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'script', placement: 'body' })
    expect(scriptText(rows[0])).toContain(JSON.stringify('"Hiragino Sans", sans-serif'))
    expect(scriptText(rows[0])).toContain('--dsw-font-family')
    expect(scriptText(rows[0])).toContain('--ds-font-family-code')
    await configuration.update({ fontFamily: '' })
    expect(collect(ctx)).toEqual([])
    await configuration.fiber.dispose()
    expect(collect(ctx)).toEqual([])
  })

  it('runs without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin({ Config, apply }).await()
    expect(collect(ctx)).toEqual([])
  })
})

it('keeps its own instance off generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
