import * as React from 'react'
import { useState } from 'react'
import { useRegisterOverlay } from '../context/overlayContext.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../ink.js'
import type { InputEvent } from '../ink/events/input-event.js'
import { setClipboard } from '../ink/termio/osc.js'
import { useEscapePriority } from '../interaction/EscapePriority.js'
import { INTERACTION_PRIORITY } from '../interaction/interactionPriority.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'

type Props = {
  title: string
  text: string
  onDone: () => void
}

export function RawMessageView({ title, text, onDone }: Props): React.ReactNode {
  useRegisterOverlay('raw-message', true)
  useEscapePriority('raw-message', onDone, INTERACTION_PRIORITY.modal)
  const { rows } = useTerminalSize()
  const lines = text.split('\n')
  const visibleLines = Math.max(3, rows - 9)
  const maxTop = Math.max(0, lines.length - visibleLines)
  const [top, setTop] = useState(0)

  useInput((input, key, event: InputEvent) => {
    if (key.escape || input === 'q') {
      event.stopImmediatePropagation()
      onDone()
      return
    }
    if (input === 'c') {
      event.stopImmediatePropagation()
      void setClipboard(text).then(raw => {
        if (raw) process.stdout.write(raw)
      })
      return
    }
    const page = Math.max(1, visibleLines - 1)
    if (key.upArrow || input === 'k') setTop(value => Math.max(0, value - 1))
    else if (key.downArrow || input === 'j')
      setTop(value => Math.min(maxTop, value + 1))
    else if (key.pageUp) setTop(value => Math.max(0, value - page))
    else if (key.pageDown || input === ' ') setTop(value => Math.min(maxTop, value + page))
    else if (key.home || input === 'g') setTop(0)
    else if (key.end || input === 'G') setTop(maxTop)
    else return
    event.stopImmediatePropagation()
  })

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="permission">{title} · raw view</Text>
      <Box flexDirection="column" height={visibleLines} overflow="hidden">
        {lines.slice(top, top + visibleLines).map((line, index) => (
          <Text key={`${top + index}:${line.slice(0, 20)}`} wrap="truncate-end">
            {line || ' '}
          </Text>
        ))}
      </Box>
      <Text dimColor>
        <Byline>
          <KeyboardShortcutHint shortcut="j/k" action="scroll" />
          <KeyboardShortcutHint shortcut="c" action="copy raw" />
          <KeyboardShortcutHint shortcut="Esc/q" action="close" />
          <Text>{lines.length === 0 ? 0 : top + 1}-{Math.min(lines.length, top + visibleLines)}/{lines.length}</Text>
        </Byline>
      </Text>
    </Box>
  )
}
