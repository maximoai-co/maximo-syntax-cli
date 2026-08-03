import { expect, test } from 'bun:test'
import {
  DISABLE_MOUSE_PROMPT_TRACKING,
  ENABLE_MOUSE_PROMPT_TRACKING,
} from './dec.js'

test('prompt tracking captures left-button clicks and drags without all-motion', () => {
  expect(ENABLE_MOUSE_PROMPT_TRACKING).toBe('\u001b[?1000h\u001b[?1002h\u001b[?1006h')
  expect(DISABLE_MOUSE_PROMPT_TRACKING).toBe('\u001b[?1006l\u001b[?1002l\u001b[?1000l')
  expect(ENABLE_MOUSE_PROMPT_TRACKING).not.toContain('?1003h')
})
