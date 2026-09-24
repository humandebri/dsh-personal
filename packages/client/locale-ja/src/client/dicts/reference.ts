/** Japanese dictionary for the `reference` namespace (client/ui-reference/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `reference` key union declared by @deepseek-ai/dsh-client-ui-reference.
import type {} from '@deepseek-ai/dsh-client-ui-reference/src/client/locales.ts'

/** `reference` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'reference'>> & Record<string, string> = {
  'section.files': 'ファイルとフォルダー',
  'section.sessions': 'セッション',
  'candidate.noCwd': '（作業ディレクトリなし）',
  'crumb.root': 'ワークスペース',
  'time.now': 'たった今',
  'time.minutes': '{n}分',
  'time.hours': '{n}時間',
  'time.days': '{n}日',
  'time.months': '{n}か月',
  'time.years': '{n}年',
}
