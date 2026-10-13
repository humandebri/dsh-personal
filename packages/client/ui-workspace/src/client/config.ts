/** Runtime bounds for navigation-owned Client Session references. */
import z from '@deepseek-ai/schemastery'

/** Client navigation limits for retaining non-visible Conversations. */
export interface Config {
  /** Number of non-visible recent conversations to keep; zero disables retention. */
  recentSessionLimit: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  recentSessionLimit: z.natural().default(3),
})
