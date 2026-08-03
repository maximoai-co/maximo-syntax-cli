import { expect, test } from 'bun:test'
import {
  getLogicalLineSelection,
  getPromptSelectionRange,
  getSegmentSelection,
  replacePromptSelection,
} from './promptSelection.js'

test('normalizes prompt selection endpoints and ignores collapsed selections', () => {
  expect(getPromptSelectionRange({ anchor: 8, focus: 2 }, 10)).toEqual({
    start: 2,
    end: 8,
  })
  expect(getPromptSelectionRange({ anchor: -5, focus: 50 }, 10)).toEqual({
    start: 0,
    end: 10,
  })
  expect(getPromptSelectionRange({ anchor: 4, focus: 4 }, 10)).toBeNull()
})

test('selects the logical line containing an offset', () => {
  const text = 'first line\nsecond line\nthird'
  expect(getLogicalLineSelection(text, 3)).toEqual({
    anchor: 0,
    focus: 10,
  })
  expect(getLogicalLineSelection(text, 15)).toEqual({
    anchor: 11,
    focus: 22,
  })
  expect(getLogicalLineSelection(text, text.length)).toEqual({
    anchor: 23,
    focus: text.length,
  })
})

test('selects the word boundary under the cursor, including the end edge', () => {
  const boundaries = [
    { start: 0, end: 5 },
    { start: 5, end: 6 },
    { start: 6, end: 11 },
  ]
  expect(getSegmentSelection(11, 2, boundaries)).toEqual({
    anchor: 0,
    focus: 5,
  })
  expect(getSegmentSelection(11, 11, boundaries)).toEqual({
    anchor: 6,
    focus: 11,
  })
})

test('replaces selected text and returns the new caret offset', () => {
  expect(
    replacePromptSelection('hello world', { anchor: 11, focus: 6 }, 'there'),
  ).toEqual({ text: 'hello there', offset: 11 })
  expect(replacePromptSelection('hello', { anchor: 2, focus: 2 }, 'x')).toBeNull()
})
