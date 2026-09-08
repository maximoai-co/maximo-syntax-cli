import { afterEach, expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import { hideReplayedCompactTail } from '../../utils/messages.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import {
  AUTOCOMPACT_DEFAULT_PERCENT,
  getAutoCompactPercent,
  getAutoCompactThreshold,
  releaseInitialAutoCompactSkip,
  shouldPreserveUnansweredTurn,
} from './autoCompact.js'
import { stripStaleUsageFromPreservedMessages } from './compact.js'

const ORIGINAL_ENV = {
  MAXIMO_SYNTAX_AUTOCOMPACT_PCT: process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
  DISABLE_COMPACT: process.env.DISABLE_COMPACT,
  MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW:
    process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW,
  MAXIMO_SYNTAX_SKIP_FIRST_AUTOCOMPACT:
    process.env.MAXIMO_SYNTAX_SKIP_FIRST_AUTOCOMPACT,
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

function user(content: unknown): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    message: {
      role: 'user',
      content,
    },
  } as Message
}

function assistant(text: string): Message {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    message: {
      id: crypto.randomUUID(),
      type: 'message',
      role: 'assistant',
      model: 'maximo-atlas-1.2',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  } as Message
}

test('preserves the first user turn instead of compacting it', () => {
  expect(
    shouldPreserveUnansweredTurn([user('what is your name?')]),
  ).toBe(true)
})

test('preserves an unanswered image and its question', () => {
  expect(
    shouldPreserveUnansweredTurn([
      user('earlier'),
      assistant('earlier response'),
      user([
        { type: 'text', text: 'what is this?' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'original-image-bytes',
          },
        },
      ]),
    ]),
  ).toBe(true)
})

test('allows normal compaction after the image has an assistant response', () => {
  expect(
    shouldPreserveUnansweredTurn([
      user([
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'original-image-bytes',
          },
        },
      ]),
      assistant('That is a screenshot.'),
      user('continue'),
    ]),
  ).toBe(false)
})

test('getAutoCompactPercent defaults to 40 without env or config override', () => {
  delete process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT
  expect(getAutoCompactPercent()).toBe(AUTOCOMPACT_DEFAULT_PERCENT)
  expect(AUTOCOMPACT_DEFAULT_PERCENT).toBe(40)
})

test('getAutoCompactPercent honors the env override and clamps to 10-70', () => {
  process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT = '55'
  expect(getAutoCompactPercent()).toBe(55)

  process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT = '5'
  expect(getAutoCompactPercent()).toBe(10)

  process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT = '95'
  expect(getAutoCompactPercent()).toBe(70)

  // Invalid values fall back to the default
  process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT = 'not-a-number'
  expect(getAutoCompactPercent()).toBe(40)

  delete process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT
})

test('zeroed post-compact usage does not count as the current context size', () => {
  const preserved = assistant('recent reply')
  preserved.message.usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const count = tokenCountWithEstimation([
    user('recent question'),
    preserved,
    user('continue'),
  ])
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(5_000)
})

test('pre-compact usage on a kept-tail assistant is ignored after a compact boundary', () => {
  const boundary = {
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: new Date().toISOString(),
    uuid: crypto.randomUUID(),
    compactMetadata: { trigger: 'auto', preTokens: 180_000 },
  } as Message
  const kept = assistant('kept tail')
  kept.message.usage = {
    input_tokens: 170_000,
    output_tokens: 10_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const count = tokenCountWithEstimation([
    boundary,
    user('summary of earlier work'),
    kept,
    user('next step'),
  ])
  expect(count).toBeLessThan(20_000)
})

test('hideReplayedCompactTail drops preserved turns after the compact divider', () => {
  const older = user('old question')
  older.timestamp = '2026-01-01T00:00:00.000Z'
  const olderReply = assistant('old reply')
  olderReply.timestamp = '2026-01-01T00:00:01.000Z'
  const boundary = {
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: '2026-01-01T00:01:00.000Z',
    uuid: crypto.randomUUID(),
    compactMetadata: { trigger: 'auto', preTokens: 10_000 },
  } as Message
  const replayed = user('old question')
  replayed.timestamp = '2026-01-01T00:00:00.000Z'
  const next = user('new question')
  next.timestamp = '2026-01-01T00:02:00.000Z'
  const visible = hideReplayedCompactTail(
    [older, olderReply, boundary, replayed, next],
    false,
  )
  expect(visible).toEqual([older, olderReply, boundary, next])
  expect(
    hideReplayedCompactTail([older, olderReply, boundary, replayed, next], true),
  ).toHaveLength(5)
})

test('stripStaleUsageFromPreservedMessages zeros assistant usage without mutating the original', () => {
  const original = assistant('kept')
  original.message.usage = {
    input_tokens: 90_000,
    output_tokens: 1_200,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const stripped = stripStaleUsageFromPreservedMessages([original])
  expect(stripped[0]).not.toBe(original)
  expect(original.message.usage.input_tokens).toBe(90_000)
  expect(
    (stripped[0] as typeof original).message.usage.input_tokens,
  ).toBe(0)
})

test('releaseInitialAutoCompactSkip is safe to call more than once', () => {
  releaseInitialAutoCompactSkip()
  releaseInitialAutoCompactSkip()
})

test('threshold is a straight percentage of the model context window', () => {
  process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW = '100000'
  process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT = '40'
  // floor(100000 * 0.40)
  expect(getAutoCompactThreshold('test-model')).toBe(40000)

  process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT = '10'
  expect(getAutoCompactThreshold('test-model')).toBe(10000)

  process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT = '70'
  expect(getAutoCompactThreshold('test-model')).toBe(70000)
})
