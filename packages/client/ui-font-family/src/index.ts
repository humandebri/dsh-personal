/** Host registration for the durable font-family preference and its pre-plugin application. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { bootFontInjection } from './boot-font.ts'
import { FONT_FAMILY_MAX_LENGTH, FONT_FAMILY_PATTERN } from './font-settings.ts'

/** Live font-family preference supplied by the profile config form. */
export interface Config {
  /** Empty string leaves the shipped font stacks in place. */
  fontFamily: Volatile<string>
}

/** Schema for the editable font-family setting. */
export const Config = z.object({
  fontFamily: z.union([
    '',
    z.string().max(FONT_FAMILY_MAX_LENGTH).pattern(FONT_FAMILY_PATTERN),
  ]).default('').volatile(),
})

/**
 * Register the durable font section when the optional settings service is
 * composed, and answer every index injection collection with the font
 * bootstrap row while a family is stored.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('webserver/index-inject', (table) => {
    const row = bootFontInjection(config.fontFamily.get() || undefined)
    if (row !== undefined) table.push(row)
  })
}
