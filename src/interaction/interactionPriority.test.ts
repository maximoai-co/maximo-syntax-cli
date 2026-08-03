import { describe, expect, test } from 'bun:test'
import {
  pickEscapeTarget,
  sortInteractionContexts,
} from './interactionPriority.js'

describe('interaction priority', () => {
  test('orders overlays and selection ahead of transcript and prompt input', () => {
    expect(
      sortInteractionContexts([
        'Global',
        'Chat',
        'Transcript',
        'CommandPalette',
        'Confirmation',
      ]),
    ).toEqual([
      'Confirmation',
      'CommandPalette',
      'Transcript',
      'Chat',
      'Global',
    ])
  })

  test('deduplicates contexts before dispatch', () => {
    expect(sortInteractionContexts(['Chat', 'Global', 'Chat'])).toEqual([
      'Chat',
      'Global',
    ])
  })

  test('Escape dismisses only the highest priority target', () => {
    const dismiss = () => {}
    expect(
      pickEscapeTarget([
        { id: 'prompt', priority: 500, dismiss },
        { id: 'queue', priority: 870, dismiss },
        { id: 'permission', priority: 850, dismiss },
      ])?.id,
    ).toBe('queue')
  })
})
