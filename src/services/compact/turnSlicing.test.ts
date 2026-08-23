import { expect, test } from 'bun:test'

import type { Message } from '../../types/message.js'
import { selectTailTurns } from './turnSlicing.js'

function user(content: unknown): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    message: { role: 'user', content },
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

function toolResult(id: string): Message {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: id, content: 'result output' },
      ],
    },
  } as Message
}

/** Builds N complete turns; turn i contains a tool_use/tool_result pair. */
function buildTurns(count: number): Message[] {
  const messages: Message[] = []
  for (let i = 0; i < count; i++) {
    messages.push(user(`turn ${i} request`))
    messages.push(assistant(`working on turn ${i}`))
    messages.push(assistant(`tool call for turn ${i}`))
    messages.push(toolResult(`tool-${i}`))
    messages.push(assistant(`done with turn ${i}`))
  }
  return messages
}

test('keeps the last three complete turns verbatim', () => {
  const messages = buildTurns(6)
  const { kept, summarizedCount } = selectTailTurns(messages, 3)
  expect(kept).toHaveLength(3 * 5)
  // First kept message is the prompt of turn 3 (index 3 of 0..5)
  expect(kept[0]).toBe(messages[15])
  expect(kept.at(-1)).toBe(messages.at(-1))
  expect(summarizedCount).toBe(3 * 5)
})

test('tool_use/tool_result pairs never split across the boundary', () => {
  const messages = buildTurns(4)
  const { kept } = selectTailTurns(messages, 3)
  const keptUuids = new Set(kept.map(m => m.uuid))
  for (const message of kept) {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      continue
    }
    for (const block of message.message.content as Array<{
      type: string
      tool_use_id?: string
    }>) {
      if (block.type === 'tool_result') {
        // The assistant message containing the matching tool_use must be kept
        const partner = messages.find(
          m =>
            m.type === 'assistant' &&
            (m.message.content as Array<{ type: string; id?: string }>).some(
              b => b.type === 'tool_use' && b.id === block.tool_use_id,
            ),
        )
        if (partner) {
          expect(keptUuids.has(partner.uuid)).toBe(true)
        }
      }
    }
  }
})

test('bails out when there is nothing meaningful to summarize', () => {
  // Single turn → no summary possible
  expect(selectTailTurns(buildTurns(1), 3).kept).toHaveLength(0)

  // Three turns, keep 3 = everything kept → nothing to summarize
  expect(selectTailTurns(buildTurns(3), 3).kept).toHaveLength(0)
})

test('two-turn conversation keeps one turn and summarizes the other', () => {
  const { kept, summarizedCount } = selectTailTurns(buildTurns(2), 3)
  expect(kept).toHaveLength(5)
  expect(summarizedCount).toBe(5)
})

test('bails out when the tail would swallow most of the conversation', () => {
  // 4 turns keep 3 = 75% kept → over the 60% guard → summary-only fallback
  expect(selectTailTurns(buildTurns(4), 3).kept).toHaveLength(0)
  // Edge: exactly 5 turns keep 3 = 60% kept → allowed (not >60%)
  expect(selectTailTurns(buildTurns(5), 3)).toHaveLength
  expect(selectTailTurns(buildTurns(5), 3).kept).toHaveLength(15)
})

test('meta and compact-summary messages never open a turn', () => {
  const messages = [
    user('first request'),
    assistant('response'),
    {
      type: 'user',
      uuid: crypto.randomUUID(),
      isMeta: true,
      message: { role: 'user', content: 'meta marker' },
    } as Message,
    {
      type: 'user',
      uuid: crypto.randomUUID(),
      isCompactSummary: true,
      message: { role: 'user', content: 'old summary' },
    } as Message,
    user('second request'),
    assistant('second response'),
  ]
  const { kept } = selectTailTurns(messages, 3)
  // Kept tail starts at the second real prompt; meta/summary stay summarized
  expect(kept[0]).toBe(messages[4])
  expect(kept).toHaveLength(2)
})

test('unanswered media in the tail forces summary-only fallback', () => {
  const messages = [
    ...buildTurns(2),
    user([
      { type: 'text', text: 'what is in this image?' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'bytes',
        },
      },
    ]),
    assistant('It shows a chart.'),
    user('now continue'),
    assistant('continuing'),
  ]
  const { kept } = selectTailTurns(messages, 3)
  expect(kept).toHaveLength(0)
})
