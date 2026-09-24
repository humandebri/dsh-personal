/** Japanese dictionary for the `documentHtml` namespace (client/ui-sidebar-documentpreview/src/client/html/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `documentHtml` key union declared by @deepseek-ai/dsh-client-ui-sidebar-documentpreview.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/html/locales.ts'

/** `documentHtml` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'documentHtml'>> & Record<string, string> = {
  'title': 'HTML',
  'frame': 'HTML ドキュメントプレビュー',
  'loading': 'HTML プレビューを準備しています…',
  'failed': 'この HTML ドキュメントをプレビューできません。',
}
