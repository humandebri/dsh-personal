/** Japanese dictionary for the `session-log-download` namespace (session-query/session-log-export/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `session-log-download` key union declared by @deepseek-ai/dsh-session-log-export.
import type {} from '@deepseek-ai/dsh-session-log-export/client'

/** `session-log-download` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'session-log-download'>> & Record<string, string> = {
  'header.more': 'その他の操作',
  'menu.download': 'セッションログをダウンロード',
  'dialog.preparingTitle': 'セッションをエクスポート中',
  'dialog.preparingDescription': '現在のセッション、サブセッション、添付ファイルを含む ZIP ファイルを準備しています。',
  'dialog.successTitle': 'セッションのエクスポートを開始しました',
  'dialog.successDescription': 'ブラウザがセッションの ZIP ファイルをダウンロードしています。',
  'dialog.errorTitle': 'セッションのエクスポートに失敗しました',
  'dialog.close': '閉じる',
  'dialog.commandFailed': 'セッションのエクスポートを開始できませんでした。',
}
