import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { catalogModels } from '../src/catalog.ts'

const fixture = vi.hoisted(() => ({ models: undefined as Model<Api>[] | undefined }))

vi.mock('@earendil-works/pi-ai/providers/all', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/providers/all')>()
  return {
    ...actual,
    getBuiltinModels: (...args: Parameters<typeof actual.getBuiltinModels>) => fixture.models ?? actual.getBuiltinModels(...args),
  }
})

afterEach(() => { fixture.models = undefined })

describe('Codex catalog fallback', () => {
  it('reports an incomplete base catalog instead of inventing a wire model', () => {
    fixture.models = []
    expect(() => catalogModels('openai-codex')).toThrow('missing gpt-6-astra')
  })

  it('preserves newer catalog entries when the installed catalog already includes them', async () => {
    const actual = await vi.importActual<typeof import('@earendil-works/pi-ai/providers/all')>('@earendil-works/pi-ai/providers/all')
    const astra = actual.getBuiltinModels('openai-codex').find(model => model.id === 'gpt-6-astra')!
    const luna = { ...astra, id: 'gpt-6-luna', name: 'Installed Luna' }
    const sol = { ...astra, id: 'gpt-6-sol', name: 'Installed Sol' }
    fixture.models = [astra, luna, sol]
    const models = catalogModels('openai-codex')
    expect(models.get(luna.id)).toBe(luna)
    expect(models.get(sol.id)).toBe(sol)
  })
})
