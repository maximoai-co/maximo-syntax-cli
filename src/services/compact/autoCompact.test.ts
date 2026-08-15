import { expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import { shouldPreserveUnansweredTurn } from './autoCompact.js'

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
