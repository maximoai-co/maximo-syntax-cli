import { describe, expect, test } from 'bun:test'
import { prependAtomicPromptState } from './promptAttachments.js'

describe('atomic prompt state merging', () => {
  test('rebases colliding attachment IDs in queued text and metadata', () => {
    const merged = prependAtomicPromptState(
      {
        text: 'queued [Image #1] and [Pasted text #2 +3 lines]',
        pastedContents: {
          1: { id: 1, type: 'image', content: 'queued-image' },
          2: { id: 2, type: 'text', content: 'queued paste' },
        },
      },
      {
        text: 'current [Image #1]',
        pastedContents: {
          1: { id: 1, type: 'image', content: 'current-image' },
        },
      },
    )

    expect(merged.text).toBe(
      'queued [Image #2] and [Pasted text #3 +3 lines]\ncurrent [Image #1]',
    )
    expect(merged.cursorOffset).toBe(
      'queued [Image #2] and [Pasted text #3 +3 lines]'.length,
    )
    expect(merged.pastedContents).toMatchObject({
      1: { id: 1, content: 'current-image' },
      2: { id: 2, content: 'queued-image' },
      3: { id: 3, content: 'queued paste' },
    })
  })

  test('preserves non-colliding IDs and handles empty editor text', () => {
    const merged = prependAtomicPromptState(
      {
        text: '[Pasted text #4]',
        pastedContents: {
          4: { id: 4, type: 'text', content: 'hello' },
        },
      },
      { text: '', pastedContents: {} },
    )
    expect(merged.text).toBe('[Pasted text #4]')
    expect(merged.pastedContents[4]?.id).toBe(4)
  })
})
