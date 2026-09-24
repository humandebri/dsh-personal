/** Japanese dictionary for the `settings.locale` namespace (client/locale/src/locales/settings.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `settings.locale` key union declared by @deepseek-ai/dsh-client-locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'

/** `settings.locale` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'settings.locale'>> & Record<string, string> = {
  'language.title': '言語',
}
