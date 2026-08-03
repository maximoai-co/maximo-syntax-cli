export type PromptTextSelection = {
  anchor: number
  focus: number
}

export type PromptSelectionRange = {
  start: number
  end: number
}

export function getPromptSelectionRange(
  selection: PromptTextSelection | null | undefined,
  textLength: number,
): PromptSelectionRange | null {
  if (!selection) return null
  const anchor = Math.max(0, Math.min(textLength, selection.anchor))
  const focus = Math.max(0, Math.min(textLength, selection.focus))
  if (anchor === focus) return null
  return {
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
  }
}

export function getLogicalLineSelection(
  text: string,
  offset: number,
): PromptTextSelection {
  const safeOffset = Math.max(0, Math.min(text.length, offset))
  const start = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1
  const newline = text.indexOf('\n', safeOffset)
  const end = newline === -1 ? text.length : newline
  return { anchor: start, focus: end }
}

export function getSegmentSelection(
  textLength: number,
  offset: number,
  boundaries: readonly { start: number; end: number }[],
): PromptTextSelection {
  const safeOffset = Math.max(0, Math.min(textLength, offset))
  const boundary =
    boundaries.find(item => safeOffset >= item.start && safeOffset < item.end) ??
    boundaries[boundaries.length - 1]
  if (!boundary) return { anchor: safeOffset, focus: safeOffset }
  return { anchor: boundary.start, focus: boundary.end }
}

export function replacePromptSelection(
  text: string,
  selection: PromptTextSelection | null | undefined,
  replacement: string,
): { text: string; offset: number } | null {
  const range = getPromptSelectionRange(selection, text.length)
  if (!range) return null
  return {
    text: text.slice(0, range.start) + replacement + text.slice(range.end),
    offset: range.start + replacement.length,
  }
}
