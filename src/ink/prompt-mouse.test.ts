import { expect, test } from 'bun:test'
import {
  shouldSuspendPromptMouseForNativeScroll,
  toPromptFrameRow,
} from './prompt-mouse.js'

test('maps absolute normal-screen mouse rows back into the rendered frame', () => {
  expect(toPromptFrameRow(38, 3, false)).toBe(34)
  expect(toPromptFrameRow(21, -11, false)).toBe(31)
})

test('keeps alt-screen mouse rows viewport-relative', () => {
  expect(toPromptFrameRow(8, 99, true)).toBe(7)
})

test('suspends prompt mouse for native scroll only on main-screen wheel', () => {
  expect(shouldSuspendPromptMouseForNativeScroll('wheelup', false)).toBe(true)
  expect(shouldSuspendPromptMouseForNativeScroll('wheeldown', false)).toBe(
    true,
  )
  // Fullscreen ScrollBox owns the wheel — leave DEC mouse modes alone.
  expect(shouldSuspendPromptMouseForNativeScroll('wheelup', true)).toBe(false)
  expect(shouldSuspendPromptMouseForNativeScroll('wheeldown', true)).toBe(
    false,
  )
  // Non-wheel keys must not suspend (would thrash click-to-place).
  expect(shouldSuspendPromptMouseForNativeScroll('a', false)).toBe(false)
  expect(shouldSuspendPromptMouseForNativeScroll('up', false)).toBe(false)
  expect(shouldSuspendPromptMouseForNativeScroll(undefined, false)).toBe(false)
})
