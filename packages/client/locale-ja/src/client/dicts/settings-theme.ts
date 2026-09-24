/** Japanese dictionary for the `settings.theme` namespace (client/ui-theme/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `settings.theme` key union declared by @deepseek-ai/dsh-client-ui-theme.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'

/** `settings.theme` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'settings.theme'>> & Record<string, string> = {
  'appearance.title': '外観',
  'appearance.light': 'ライト',
  'appearance.dark': 'ダーク',
  'appearance.system': 'システム',
  'fontSize.title': 'フォントサイズ',
  'fontSize.description': '会話の内容にのみ影響します',
  'fontSize.unit': 'px',
  'fontSize.increase': 'フォントサイズを大きくする',
  'fontSize.decrease': 'フォントサイズを小さくする',
}
