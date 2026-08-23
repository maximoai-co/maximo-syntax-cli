import { afterEach, expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import {
  AUTOCOMPACT_DEFAULT_PERCENT,
  getAutoCompactPercent,
  getAutoCompactThreshold,
  shouldPreserveUnansweredTurn,
} from './autoCompact.js'

const ORIGINAL_ENV = {
  MAXIMO_SYNTAX_AUTOCOMPACT_PCT: process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:
    process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
  DISABLE_COMPACT: process.env.DISABLE_COMPACT,
  MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW:
    process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW,
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
