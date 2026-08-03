import type { DOMElement } from './dom.js'

/** A mouse event translated to coordinates relative to a prompt target. */
export type PromptMouseEvent = {
  action: 'press' | 'release'
  button: number
  col: number
  row: number
  localCol: number
  localRow: number
  inside: boolean
}

export type PromptMouseHandler = (event: PromptMouseEvent) => void

export type PromptMouseTarget = {
  node: DOMElement
  handler: PromptMouseHandler
}

/** Convert a 1-indexed SGR viewport row into Maximo's 0-indexed frame row. */
export function toPromptFrameRow(
  terminalRow: number,
  mainScreenRowOffset: number | null,
  altScreen: boolean,
): number {
  return terminalRow - 1 - (altScreen ? 0 : (mainScreenRowOffset ?? 0))
}

/**
 * Whether a key should suspend main-screen prompt mouse tracking so the
 * terminal's native scrollback can receive subsequent wheel events.
 *
 * DEC 1000 (used for click-to-place on the normal screen) captures the
 * wheel; without suspension, native scroll is dead while the CLI runs —
 * especially painful while a response is streaming and the user tries to
 * read earlier output. Fullscreen leaves tracking alone (ScrollBox handles
 * the wheel via keybindings).
 */
export function shouldSuspendPromptMouseForNativeScroll(
  keyName: string | undefined,
  altScreenActive: boolean,
): boolean {
  if (altScreenActive) return false
  return keyName === 'wheelup' || keyName === 'wheeldown'
}
