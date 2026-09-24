/** Japanese dictionary for the `gitBranch` namespace (client/ui-git-branch/src/client/locales.ts). */
import type { LocaleDictOf } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: loads the `gitBranch` key union declared by @deepseek-ai/dsh-client-ui-git-branch.
import type {} from '@deepseek-ai/dsh-client-ui-git-branch/client'

/** `gitBranch` copy in Japanese, with newly added owner keys falling back to English. */
export const ja: Partial<LocaleDictOf<'gitBranch'>> & Record<string, string> = {
  'branch.tooltip': 'ブランチ {ref}',
  'detached.tooltip': 'detached HEAD {ref}',
  'worktree.tooltip': '(worktree {name})',
}
