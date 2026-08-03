import { expect, test } from 'bun:test'
import { INITIAL_STATE, parseMultipleKeypresses } from './parse-keypress.js'

function x10Mouse(button: number, col: number, row: number): string {
  return `\x1b[M${String.fromCharCode(button + 32)}${String.fromCharCode(
    col + 32,
  )}${String.fromCharCode(row + 32)}`
}

test('parses legacy X10 prompt click, drag, and release events', () => {
  const [events] = parseMultipleKeypresses(
    INITIAL_STATE,
    `${x10Mouse(0, 3, 8)}${x10Mouse(32, 7, 8)}${x10Mouse(3, 7, 8)}`,
  )

  expect(events).toEqual([
    {
      kind: 'mouse',
      button: 0,
      action: 'press',
      col: 3,
      row: 8,
      sequence: x10Mouse(0, 3, 8),
    },
    {
      kind: 'mouse',
      button: 32,
      action: 'press',
      col: 7,
      row: 8,
      sequence: x10Mouse(32, 7, 8),
    },
    {
      kind: 'mouse',
      button: 3,
      action: 'release',
      col: 7,
      row: 8,
      sequence: x10Mouse(3, 7, 8),
    },
  ])
})

test('keeps legacy X10 wheel events on the existing scroll-key path', () => {
  const [events] = parseMultipleKeypresses(
    INITIAL_STATE,
    x10Mouse(64, 3, 8),
  )

  expect(events[0]).toMatchObject({
    kind: 'key',
    name: 'wheelup',
  })
})
