/** Japanese dictionary for the `sidebar` namespace (client/ui-sidebar/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `sidebar` key union declared by @deepseek-ai/dsh-client-ui-sidebar.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** `sidebar` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'sidebar'>> & Record<string, string> = {
  'session.new': '新規セッション',
  'session.new.label': '新規セッション',
  'toggle.open': 'サイドバーを開く',
  'toggle.collapse': 'サイドバーを折りたたむ',
  'panels.label': 'グローバルパネル',
}
