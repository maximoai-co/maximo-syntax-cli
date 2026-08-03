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
