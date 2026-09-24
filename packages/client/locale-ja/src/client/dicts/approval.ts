/** Japanese dictionary for the `approval` namespace (client/ui-approval/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `approval` key union declared by @deepseek-ai/dsh-client-ui-approval.
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'

/** `approval` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'approval'>> & Record<string, string> = {
  'waiting': '承認待ち',
  'reviewFailed': '自動レビューに失敗しました。判断を待っています',
  'retryReview': 'レビューを再試行',
  'detail.aria': '承認の詳細',
  'escalation': 'ツール {toolName} が特権実行を要求しています',
  'reject': '拒否',
  'allowOnce': '1 回だけ許可',
}
