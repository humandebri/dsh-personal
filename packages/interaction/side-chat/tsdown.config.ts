import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-side-chat',
  ['lib/types/index.js'],
  { hostPhase: true },
)
