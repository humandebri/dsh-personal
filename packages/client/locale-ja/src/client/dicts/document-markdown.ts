/** Japanese dictionary for the `documentMarkdown` namespace (client/ui-sidebar-documentpreview/src/client/markdown/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `documentMarkdown` key union declared by @deepseek-ai/dsh-client-ui-sidebar-documentpreview.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/markdown/locales.ts'

/** `documentMarkdown` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'documentMarkdown'>> & Record<string, string> = {
  'viewer.label': 'Markdown',
  'code.copy': 'コピー',
  'code.copied': 'コピーしました',
  'footnotes': '脚注',
}
