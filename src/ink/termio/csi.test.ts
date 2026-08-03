import { expect, test } from 'bun:test'
import {
  BLINKING_BAR_CURSOR,
  DEFAULT_CURSOR_STYLE,
  REQUEST_CURSOR_POSITION,
} from './csi.js'

test('emits xterm-compatible blinking bar and default cursor styles', () => {
  expect(BLINKING_BAR_CURSOR).toBe('\u001b[5 q')
  expect(DEFAULT_CURSOR_STYLE).toBe('\u001b[0 q')
  expect(REQUEST_CURSOR_POSITION).toBe('\u001b[?6n')
})
