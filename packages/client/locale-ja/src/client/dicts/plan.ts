/** Japanese dictionary for the `plan` namespace (client/ui-plan/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `plan` key union declared by @deepseek-ai/dsh-client-ui-plan.
import type {} from '@deepseek-ai/dsh-client-ui-plan/client'

/** `plan` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'plan'>> & Record<string, string> = {
  'chip.label': 'Plan',
  'chip.on.aria': 'プランモードはオンです。押すとオフになります',
  'chip.on.title': 'プランモードはオン — クリックでオフ（/plan off）',
  'chip.off.aria': 'プランモードはオフです。押すとオンになります',
  'chip.off.title': 'プランモードはオフ — クリックでオン（/plan）',
  'chip.exitFailed': 'プランモードの終了に失敗しました',
}
