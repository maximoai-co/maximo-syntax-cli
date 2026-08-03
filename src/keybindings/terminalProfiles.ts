import { env } from '../utils/env.js'

export const TERMINAL_SHORTCUT_PROFILES = [
  'auto',
  'portable',
  'modern',
  'vscode',
  'apple-terminal',
] as const

export type TerminalShortcutProfile =
  (typeof TERMINAL_SHORTCUT_PROFILES)[number]

export type ResolvedTerminalShortcutProfile = Exclude<
  TerminalShortcutProfile,
  'auto'
>

export type TerminalProfileBindings = {
  commandPalette: string
  queue: string
  redo: readonly string[]
}

export function detectTerminalShortcutProfile(): ResolvedTerminalShortcutProfile {
  if (process.env.TERM_PROGRAM === 'vscode') return 'vscode'
  if (env.terminal === 'Apple_Terminal') return 'apple-terminal'
  if (
    env.terminal === 'kitty' ||
    env.terminal === 'ghostty' ||
    env.terminal === 'iTerm.app' ||
    process.env.WEZTERM_PANE
  ) {
    return 'modern'
  }
  return 'portable'
}

export function resolveTerminalShortcutProfile(
  profile: TerminalShortcutProfile | undefined,
): ResolvedTerminalShortcutProfile {
  return !profile || profile === 'auto'
    ? detectTerminalShortcutProfile()
    : profile
}

/**
 * Host-aware defaults. Chords are used where the terminal host commonly owns
 * ctrl+p/ctrl+q before those bytes reach the PTY.
 */
export function getTerminalProfileBindings(
  profile: TerminalShortcutProfile | undefined,
): TerminalProfileBindings {
  switch (resolveTerminalShortcutProfile(profile)) {
    case 'vscode':
      return {
        commandPalette: 'ctrl+x p',
        queue: 'ctrl+x q',
        redo: ['ctrl+y', 'ctrl+shift+z'],
      }
    case 'apple-terminal':
      return {
        commandPalette: 'ctrl+p',
        queue: 'ctrl+x q',
        redo: ['ctrl+y'],
      }
    case 'modern':
    case 'portable':
      return {
        commandPalette: 'ctrl+p',
        queue: 'ctrl+q',
        redo: ['ctrl+y', 'ctrl+shift+z'],
      }
  }
}

