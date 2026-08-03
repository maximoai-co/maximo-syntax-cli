import { useCallback, useRef, useState } from 'react'
import type { PastedContent } from '../utils/config.js'

export type BufferEntry = {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
  timestamp: number
}

export type InputSnapshot = Omit<BufferEntry, 'timestamp'>

export type UseInputBufferProps = {
  maxBufferSize: number
  debounceMs: number
}

export type UseInputBufferResult = {
  pushToBuffer: (
    text: string,
    cursorOffset: number,
    pastedContents?: Record<number, PastedContent>,
  ) => void
  undo: (current: InputSnapshot) => BufferEntry | undefined
  redo: (current: InputSnapshot) => BufferEntry | undefined
  canUndo: boolean
  canRedo: boolean
  clearBuffer: () => void
}

function makeEntry(snapshot: InputSnapshot): BufferEntry {
  return {
    ...snapshot,
    pastedContents: { ...snapshot.pastedContents },
    timestamp: Date.now(),
  }
}

function sameSnapshot(a: InputSnapshot | undefined, b: InputSnapshot): boolean {
  if (!a || a.text !== b.text || a.cursorOffset !== b.cursorOffset) return false
  const aKeys = Object.keys(a.pastedContents)
  const bKeys = Object.keys(b.pastedContents)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every(key => {
    const left = a.pastedContents[Number(key)]
    const right = b.pastedContents[Number(key)]
    return (
      left?.id === right?.id &&
      left?.type === right?.type &&
      left?.content === right?.content
    )
  })
}

/** Prompt-local edit history with attachment-aware undo and redo. */
export function useInputBuffer({
  maxBufferSize,
  debounceMs,
}: UseInputBufferProps): UseInputBufferResult {
  const undoStack = useRef<BufferEntry[]>([])
  const redoStack = useRef<BufferEntry[]>([])
  const lastPushTime = useRef(0)
  const [, rerender] = useState(0)

  const updateAvailability = useCallback(() => rerender(value => value + 1), [])

  const pushToBuffer = useCallback(
    (
      text: string,
      cursorOffset: number,
      pastedContents: Record<number, PastedContent> = {},
    ) => {
      const snapshot = { text, cursorOffset, pastedContents }
      const now = Date.now()
      const last = undoStack.current[undoStack.current.length - 1]
      if (now - lastPushTime.current < debounceMs && last) return
      lastPushTime.current = now
      if (sameSnapshot(last, snapshot)) return

      undoStack.current.push(makeEntry(snapshot))
      if (undoStack.current.length > maxBufferSize) undoStack.current.shift()
      redoStack.current = []
      updateAvailability()
    },
    [debounceMs, maxBufferSize, updateAvailability],
  )

  const undo = useCallback(
    (current: InputSnapshot): BufferEntry | undefined => {
      const previous = undoStack.current.pop()
      if (!previous) return undefined
      if (!sameSnapshot(redoStack.current.at(-1), current)) {
        redoStack.current.push(makeEntry(current))
      }
      lastPushTime.current = 0
      updateAvailability()
      return previous
    },
    [updateAvailability],
  )

  const redo = useCallback(
    (current: InputSnapshot): BufferEntry | undefined => {
      const next = redoStack.current.pop()
      if (!next) return undefined
      if (!sameSnapshot(undoStack.current.at(-1), current)) {
        undoStack.current.push(makeEntry(current))
        if (undoStack.current.length > maxBufferSize) undoStack.current.shift()
      }
      lastPushTime.current = 0
      updateAvailability()
      return next
    },
    [maxBufferSize, updateAvailability],
  )

  const clearBuffer = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    lastPushTime.current = 0
    updateAvailability()
  }, [updateAvailability])

  return {
    pushToBuffer,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    clearBuffer,
  }
}
