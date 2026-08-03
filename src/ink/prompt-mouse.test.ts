import { expect, test } from 'bun:test'
import { toPromptFrameRow } from './prompt-mouse.js'

test('maps absolute normal-screen mouse rows back into the rendered frame', () => {
  expect(toPromptFrameRow(38, 3, false)).toBe(34)
  expect(toPromptFrameRow(21, -11, false)).toBe(31)
})

test('keeps alt-screen mouse rows viewport-relative', () => {
  expect(toPromptFrameRow(8, 99, true)).toBe(7)
})
