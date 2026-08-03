import { describe, expect, test } from 'bun:test'
import { getTerminalProfileBindings } from './terminalProfiles.js'

describe('terminal shortcut profiles', () => {
  test('uses portable single-key shortcuts by default', () => {
    expect(getTerminalProfileBindings('portable')).toEqual({
      commandPalette: 'ctrl+p',
      queue: 'ctrl+q',
      redo: ['ctrl+y', 'ctrl+shift+z'],
    })
  })

  test('avoids VS Code-owned shortcuts with chords', () => {
    expect(getTerminalProfileBindings('vscode')).toEqual({
      commandPalette: 'ctrl+x p',
      queue: 'ctrl+x q',
      redo: ['ctrl+y', 'ctrl+shift+z'],
    })
  })

  test('uses a terminal-safe redo binding for Apple Terminal', () => {
    expect(getTerminalProfileBindings('apple-terminal').redo).toEqual([
      'ctrl+y',
    ])
  })
})
