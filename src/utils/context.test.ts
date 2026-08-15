import { afterEach, expect, test } from 'bun:test'

import { getMaxOutputTokensForModel } from '../services/api/maximo.ts'
import {
  getAutoCompactThreshold,
  getEffectiveContextWindowSize,
} from '../services/compact/autoCompact.ts'
import {
  clearMaximoModelsCache,
  fetchMaximoModels,
} from '../services/api/maximoModels.ts'
import {
  getCompactSummaryMaxOutputTokensForModel,
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from './context.ts'
import {
  getDefaultEffortForModel,
  getSupportedEffortLevelsForModel,
  modelSupportsEffort,
  resolveAppliedEffort,
} from './effort.ts'

const originalEnv = {
  MAXIMO_SYNTAX_USE_OPENAI: process.env.MAXIMO_SYNTAX_USE_OPENAI,
  MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS: process.env.MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS,
  MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW:
    process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
}
const originalFetch = globalThis.fetch

afterEach(() => {
  process.env.MAXIMO_SYNTAX_USE_OPENAI = originalEnv.MAXIMO_SYNTAX_USE_OPENAI
  process.env.MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS =
    originalEnv.MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS
  process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW =
    originalEnv.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW
  process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE =
    originalEnv.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  globalThis.fetch = originalFetch
  clearMaximoModelsCache()
})

test('deepseek-chat uses provider-specific context and output caps', () => {
  process.env.MAXIMO_SYNTAX_USE_OPENAI = '1'
  delete process.env.MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS

  expect(getContextWindowForModel('deepseek-chat')).toBe(128_000)
  expect(getModelMaxOutputTokens('deepseek-chat')).toEqual({
    default: 8_192,
    upperLimit: 8_192,
  })
  expect(getMaxOutputTokensForModel('deepseek-chat')).toBe(8_192)
})

test('deepseek-chat clamps oversized max output overrides to the provider limit', () => {
  process.env.MAXIMO_SYNTAX_USE_OPENAI = '1'
  process.env.MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS = '32000'

  expect(getMaxOutputTokensForModel('deepseek-chat')).toBe(8_192)
})

test('does not invent effort lists or clamp max before provider metadata is cached', () => {
  clearMaximoModelsCache()

  expect(getSupportedEffortLevelsForModel('maximo-atlas-1.2')).toBeUndefined()
  expect(getSupportedEffortLevelsForModel('maximo-pandora-3.8-nano')).toBeUndefined()
  expect(resolveAppliedEffort('maximo-pandora-3.8-nano', 'max')).toBe('max')
})

test('Maximo model metadata drives context and output limits', async () => {
  process.env.MAXIMO_SYNTAX_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.maximoai.co/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  delete process.env.MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS
  delete process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW
  delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE

  const maximoModels = [
    {
      id: 'maximo-pandora-3.7-nano',
      name: 'Maximo AI: Pandora 3.7 Nano',
      canonical_slug: 'maximo-ai/pandora-3.7-nano',
      context_length: 1_000_000,
      max_output_length: 128_000,
    },
    {
      id: 'maximo-alpha-nano',
      name: 'Maximo Alpha Nano',
      canonical_slug: 'maximo-ai/alpha-nano',
      context_length: 163_000,
      max_output_length: 65_000,
    },
  ]
  const expectedReserve = (
    model: (typeof maximoModels)[number],
    contextWindow = model.context_length,
  ) => {
    const outputRatio = model.max_output_length / model.context_length
    return Math.floor(
      Math.min(
        model.max_output_length,
        contextWindow,
        contextWindow * outputRatio,
      ),
    )
  }

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: maximoModels.map(model => ({
          id: model.id,
          name: model.name,
          description: 'Coding model',
          context_length: model.context_length,
          max_output_length: model.max_output_length,
          quantization: '',
          input_modalities: ['text'],
          output_modalities: ['text'],
          architecture: {
            modality: 'text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'test',
            instruct_type: null,
          },
          pricing: {
            prompt: '0',
            completion: '0',
          },
          supported_sampling_parameters: [],
          supported_features: [],
          openrouter: {
            slug: model.canonical_slug,
          },
          datacenters: [],
          canonical_slug: model.canonical_slug,
          top_provider: {
            context_length: model.context_length,
            max_completion_tokens: model.max_output_length,
            is_moderated: false,
          },
          per_request_limits: null,
          supported_parameters: [],
          default_parameters: {
            temperature: 0,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
          },
        })),
      })
    )) as typeof fetch

  await fetchMaximoModels()

  for (const model of maximoModels) {
    const reserve = expectedReserve(model)
    expect(getContextWindowForModel(model.id)).toBe(model.context_length)
    expect(getModelMaxOutputTokens(model.id)).toEqual({
      default: model.max_output_length,
      upperLimit: model.max_output_length,
    })
    expect(getMaxOutputTokensForModel(model.id)).toBe(model.max_output_length)
    expect(getCompactSummaryMaxOutputTokensForModel(model.id)).toBe(reserve)
    expect(getEffectiveContextWindowSize(model.id)).toBe(
      model.context_length - reserve,
    )
    expect(getAutoCompactThreshold(model.id)).toBe(
      model.context_length - reserve,
    )
  }

  process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW = '500000'
  const nanoModel = maximoModels[0]!
  const cappedReserve = expectedReserve(nanoModel, 500_000)
  expect(getCompactSummaryMaxOutputTokensForModel(nanoModel.id, 500_000)).toBe(
    cappedReserve,
  )
  expect(getEffectiveContextWindowSize(nanoModel.id)).toBe(
    500_000 - cappedReserve,
  )
})

test('invalid provider output metadata cannot collapse the effective context window', async () => {
  process.env.MAXIMO_SYNTAX_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.mytabulon.com/v1'
  process.env.OPENAI_API_KEY = 'test-key'
  delete process.env.MAXIMO_SYNTAX_MAX_OUTPUT_TOKENS
  delete process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW
  delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: 'maximo-atlas-1.2',
            name: 'Maximo Atlas 1.2',
            context_window: 262_000,
            // Some OpenAI-compatible model registries use max_tokens for the
            // total window. It must not be interpreted as an output reserve.
            max_tokens: 262_000,
            reasoning_efforts: ['low', 'medium', 'high'],
            reasoning: {
              supported_efforts: ['low', 'medium', 'high'],
              default_effort: 'medium',
            },
          },
        ],
      }),
    )) as typeof fetch

  await fetchMaximoModels({
    forceRefresh: true,
    persistMyTabulonAccount: false,
  })

  expect(getContextWindowForModel('maximo-atlas-1.2')).toBe(262_000)
  expect(getCompactSummaryMaxOutputTokensForModel('maximo-atlas-1.2')).toBe(
    20_000,
  )
  expect(getEffectiveContextWindowSize('maximo-atlas-1.2')).toBe(242_000)
  expect(getAutoCompactThreshold('maximo-atlas-1.2')).toBe(229_000)
  expect(getSupportedEffortLevelsForModel('maximo-atlas-1.2')).toEqual([
    'low',
    'medium',
    'high',
  ])
  expect(getDefaultEffortForModel('maximo-atlas-1.2')).toBe('medium')
  expect(modelSupportsEffort('maximo-atlas-1.2')).toBe(true)
})

test('Pandora 3.8 nano efforts come from the provider catalog including max', async () => {
  process.env.MAXIMO_SYNTAX_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.maximoai.co/v1'
  process.env.OPENAI_API_KEY = 'test-key'

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: 'maximo-pandora-3.8-nano',
            name: 'Maximo AI: Pandora 3.8 Nano',
            reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
            reasoning: {
              supported_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
              default_effort: 'high',
            },
          },
        ],
      }),
    )) as typeof fetch

  await fetchMaximoModels({
    forceRefresh: true,
    persistMyTabulonAccount: false,
  })

  expect(getSupportedEffortLevelsForModel('maximo-pandora-3.8-nano')).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ])
  expect(resolveAppliedEffort('maximo-pandora-3.8-nano', 'max')).toBe('max')
  expect(modelSupportsEffort('maximo-pandora-3.8-nano')).toBe(true)
})
