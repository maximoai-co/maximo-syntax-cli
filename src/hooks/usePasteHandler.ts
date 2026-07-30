import { basename } from 'path'
import React from 'react'
import { logError } from 'src/utils/log.js'
import type { InputEvent, Key } from '../ink.js'
import {
  getImageFromClipboard,
  isImageFilePath,
  PASTE_THRESHOLD,
  splitPastedFilePaths,
  tryReadImageFromPath,
} from '../utils/imagePaste.js'
import type { ImageDimensions } from '../utils/imageResizer.js'
import { getPlatform } from '../utils/platform.js'

const PASTE_COMPLETION_TIMEOUT_MS = 100

type PasteHandlerProps = {
  onPaste?: (text: string) => void
  onInput: (input: string, key: Key) => void
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
    originalSizeBytes?: number,
  ) => void
  onImagePasteError?: (message: string) => void
}

export function usePasteHandler({
  onPaste,
  onInput,
  onImagePaste,
  onImagePasteError,
}: PasteHandlerProps): {
  wrappedOnInput: (input: string, key: Key, event: InputEvent) => void
  pasteState: {
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }
  isPasting: boolean
} {
  const [pasteState, setPasteState] = React.useState<{
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }>({ chunks: [], timeoutId: null })
  const [isPasting, setIsPasting] = React.useState(false)
  const isMountedRef = React.useRef(true)
  // Mirrors pasteState.timeoutId but updated synchronously. When paste + a
  // keystroke arrive in the same stdin chunk, both wrappedOnInput calls run
  // in the same discreteUpdates batch before React commits — the second call
  // reads stale pasteState.timeoutId (null) and takes the onInput path. If
  // that key is Enter, it submits the old input and the paste is lost.
  const pastePendingRef = React.useRef(false)

  const isMacOS = React.useMemo(() => getPlatform() === 'macos', [])

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const checkClipboardForImage = React.useCallback(async (): Promise<boolean> => {
    if (!onImagePaste || !isMountedRef.current) return false

    try {
      const imageData = await getImageFromClipboard()
      if (!imageData || !isMountedRef.current) return false

      onImagePaste(
        imageData.base64,
        imageData.mediaType,
        imageData.sourcePath
          ? basename(imageData.sourcePath)
          : undefined,
        imageData.dimensions,
        imageData.sourcePath,
        imageData.originalSizeBytes,
      )
      return true
    } catch (error) {
      if (isMountedRef.current) {
        logError(error as Error)
      }
      return false
    }
  }, [onImagePaste])

  const processPastedContent = React.useCallback(
    async (
      pastedText: string,
      options: { checkClipboard: boolean },
    ): Promise<void> => {
      const cleanedText = pastedText
        .replace(/\[I$/, '')
        .replace(/\[O$/, '')
      const parts = splitPastedFilePaths(cleanedText)
      const imagePaths = parts.filter(part => isImageFilePath(part))

      try {
        if (onImagePaste && imagePaths.length > 0) {
          const results = await Promise.all(
            imagePaths.map(imagePath => tryReadImageFromPath(imagePath)),
          )
          const validImages = results.filter(
            (result): result is NonNullable<typeof result> => result !== null,
          )

          if (validImages.length > 0 && isMountedRef.current) {
            for (const imageData of validImages) {
              onImagePaste(
                imageData.base64,
                imageData.mediaType,
                basename(imageData.path),
                imageData.dimensions,
                imageData.path,
                imageData.originalSizeBytes,
              )
            }

            const nonImageParts = parts.filter(part => !isImageFilePath(part))
            if (nonImageParts.length > 0) {
              onPaste?.(nonImageParts.join(' '))
            }
            return
          }

          if (
            options.checkClipboard &&
            (await checkClipboardForImage())
          ) {
            return
          }

          // A drop/paste that consists only of image-looking paths is an
          // attachment action. Never degrade it into ordinary filename text.
          // That was the source of `question?photo.png` in the prompt.
          if (imagePaths.length === parts.length) {
            onImagePasteError?.(
              `Could not attach image: ${basename(imagePaths[0] ?? 'image')}`,
            )
            return
          }

          onPaste?.(cleanedText)
          return
        }

        // VS Code and other terminal emulators represent Cmd+V as a
        // bracketed-paste event. When the clipboard contains an image, that
        // event can be empty or contain a terminal-specific placeholder.
        // Resolve the clipboard before treating its payload as ordinary text.
        if (
          options.checkClipboard &&
          onImagePaste &&
          (await checkClipboardForImage())
        ) {
          return
        }

        onPaste?.(cleanedText)
      } finally {
        if (isMountedRef.current) {
          setIsPasting(false)
        }
      }
    },
    [checkClipboardForImage, onImagePaste, onImagePasteError, onPaste],
  )

  const resetPasteTimeout = React.useCallback(
    (currentTimeoutId: ReturnType<typeof setTimeout> | null) => {
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId)
      }
      return setTimeout(
        (
          setPasteState,
          processPastedContent,
          pastePendingRef,
        ) => {
          pastePendingRef.current = false
          setPasteState(({ chunks }) => {
            void processPastedContent(chunks.join(''), {
              checkClipboard: false,
            })
            return { chunks: [], timeoutId: null }
          })
        },
        PASTE_COMPLETION_TIMEOUT_MS,
        setPasteState,
        processPastedContent,
        pastePendingRef,
      )
    },
    [processPastedContent],
  )

  // Paste detection is now done via the InputEvent's keypress.isPasted flag,
  // which is set by the keypress parser when it detects bracketed paste mode.
  // This avoids the race condition caused by having multiple listeners on stdin.
  // Previously, we had a stdin.on('data') listener here which competed with
  // the 'readable' listener in App.tsx, causing dropped characters.

  const wrappedOnInput = (input: string, key: Key, event: InputEvent): void => {
    // Detect paste from the parsed keypress event.
    // The keypress parser sets isPasted=true for content within bracketed paste.
    const isFromPaste = event.keypress.isPasted

    // If this is pasted content, set isPasting state for UI feedback
    if (isFromPaste) {
      setIsPasting(true)
    }

    // Handle large pastes (>PASTE_THRESHOLD chars)
    // Usually we get one or two input characters at a time. If we
    // get more than the threshold, the user has probably pasted.
    // Unfortunately node batches long pastes, so it's possible
    // that we would see e.g. 1024 characters and then just a few
    // more in the next frame that belong with the original paste.
    // This batching number is not consistent.

    // Handle potential image filenames (even if they're shorter than paste threshold)
    // When dragging multiple images, they may come as newline-separated or
    // space-separated paths. Split on spaces preceding absolute paths:
    // - Unix: ` /` - Windows: ` C:\` etc.
    const hasImageFilePath = splitPastedFilePaths(input).some((line) =>
      isImageFilePath(line)
    )

    // Bracketed paste is already a complete payload. Resolve image paths and
    // the macOS clipboard before ordinary text so the terminal cannot race an
    // image paste into the delayed text-paste state.
    if (isFromPaste) {
      pastePendingRef.current = false
      if (pasteState.timeoutId) {
        clearTimeout(pasteState.timeoutId)
      }
      setPasteState({ chunks: [], timeoutId: null })
      void processPastedContent(input, { checkClipboard: isMacOS })
      return
    }

    // Finder and some terminal emulators insert a dragged file path without
    // bracketed-paste markers. Image paths are complete enough to resolve
    // immediately, avoiding the same text-paste timeout race.
    if (hasImageFilePath && onImagePaste) {
      setIsPasting(true)
      void processPastedContent(input, { checkClipboard: isMacOS })
      return
    }

    // Check if we should handle as paste (from bracketed paste, large input, or continuation)
    const shouldHandleAsPaste =
      onPaste &&
      (input.length > PASTE_THRESHOLD ||
        pastePendingRef.current ||
        hasImageFilePath)

    if (shouldHandleAsPaste) {
      pastePendingRef.current = true
      setPasteState(({ chunks, timeoutId }) => {
        return {
          chunks: [...chunks, input],
          timeoutId: resetPasteTimeout(timeoutId),
        }
      })
      return
    }
    onInput(input, key)
    if (input.length > 10) {
      // Ensure that setIsPasting is turned off on any other multicharacter
      // input, because the stdin buffer may chunk at arbitrary points and split
      // the closing escape sequence if the input length is too long for the
      // stdin buffer.
      setIsPasting(false)
    }
  }

  return {
    wrappedOnInput,
    pasteState,
    isPasting,
  }
}
