/** Japanese dictionary for the `sidebarImage` namespace (client/ui-sidebar-documentpreview/src/client/image/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `sidebarImage` key union declared by @deepseek-ai/dsh-client-ui-sidebar-documentpreview.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/image/locales.ts'

/** `sidebarImage` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'sidebarImage'>> & Record<string, string> = {
  'title': '画像',
  'preview': '画像プレビュー：{name}',
  'loading': '画像を開いています…',
  'failed': 'この画像を表示できません。',
  'unsupported': '画像プレビューにはファイル全体の内容が必要です。',
}
