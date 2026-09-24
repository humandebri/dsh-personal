/** Japanese dictionary for the `goal` namespace (client/ui-goal/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `goal` key union declared by @deepseek-ai/dsh-client-ui-goal.
import type {} from '@deepseek-ai/dsh-client-ui-goal/client'

/** `goal` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'goal'>> & Record<string, string> = {
  'phase.active': '進行中のゴール',
  'phase.active.disarmed': '非アクティブなゴール',
  'phase.paused': '一時停止中のゴール',
  'phase.blocked': 'ブロック中のゴール',
  'objective.aria': 'ゴールの内容',
  'commandInput.aria': 'コマンド入力',
  'action.save': 'ゴールを保存',
  'action.cancel': '編集をキャンセル',
  'action.pause': 'ゴールを一時停止',
  'action.resume': 'ゴールを再開',
  'action.edit': 'ゴールを編集',
  'action.clear': 'ゴールをクリア',
}
