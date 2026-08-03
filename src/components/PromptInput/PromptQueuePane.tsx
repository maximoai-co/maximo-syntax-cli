import * as React from 'react'
import { useMemo, useState } from 'react'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import { useCommandQueue } from '../../hooks/useCommandQueue.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Text } from '../../ink.js'
import { useEscapePriority } from '../../interaction/EscapePriority.js'
import { INTERACTION_PRIORITY } from '../../interaction/interactionPriority.js'
import { useRegisterKeybindingContext } from '../../keybindings/KeybindingContext.js'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  isQueuedCommandEditable,
  isQueuedCommandVisible,
} from '../../utils/messageQueueManager.js'
import { truncateToWidth } from '../../utils/format.js'
import { FuzzyPicker } from '../design-system/FuzzyPicker.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'

type Props = {
  onDone: () => void
  onEdit: (command: QueuedCommand) => void
  onRemove: (command: QueuedCommand) => void
  onMove: (command: QueuedCommand, delta: number) => void
  onSendNow: (command: QueuedCommand) => void
}

function commandText(command: QueuedCommand): string {
  if (typeof command.value === 'string') return command.value.replace(/\s+/g, ' ')
  return command.value
    .filter(block => block.type === 'text')
    .map(block => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
}

export function PromptQueuePane({
  onDone,
  onEdit,
  onRemove,
  onMove,
  onSendNow,
}: Props): React.ReactNode {
  useRegisterOverlay('prompt-queue', true)
  useRegisterKeybindingContext('Queue', true)
  useEscapePriority('prompt-queue', onDone, INTERACTION_PRIORITY.queue)
  const queue = useCommandQueue()
  const visible = useMemo(() => queue.filter(isQueuedCommandVisible), [queue])
  const [items, setItems] = useState<readonly QueuedCommand[]>(visible)

  React.useEffect(() => setItems(visible), [visible])

  const handleItemKey = (event: KeyboardEvent, command?: QueuedCommand) => {
    if (!command) return false
    if (event.key === 'backspace' || event.key === 'delete' || event.key === 'd') {
      onRemove(command)
      return true
    }
    if (event.key === 'n') {
      onSendNow(command)
      return true
    }
    if (event.ctrl && event.key === 'up') {
      onMove(command, -1)
      return true
    }
    if (event.ctrl && event.key === 'down') {
      onMove(command, 1)
      return true
    }
    return false
  }

  return (
    <FuzzyPicker
      title={`Interactive queue · ${visible.length} pending`}
      placeholder="Filter queued prompts…"
      items={items}
      getKey={command => command.uuid ?? `${commandText(command)}:${command.mode}`}
      onQueryChange={query => {
        const normalized = query.trim().toLowerCase()
        setItems(
          normalized
            ? visible.filter(command => commandText(command).toLowerCase().includes(normalized))
            : visible,
        )
      }}
      onSelect={command => {
        if (isQueuedCommandEditable(command)) onEdit(command)
      }}
      onCancel={onDone}
      onItemKeyDown={handleItemKey}
      selectAction="edit"
      emptyMessage="Queue is empty"
      renderItem={(command, focused) => (
        <Text color={focused ? 'suggestion' : undefined} dimColor={!isQueuedCommandEditable(command)}>
          <Text bold>[{command.priority ?? 'next'}]</Text>{' '}
          {truncateToWidth(commandText(command) || '(system notification)', 80)}{' '}
          <Text dimColor>
            {command.mode}
            {command.pastedContents
              ? ` · ${Object.keys(command.pastedContents).length} attachment(s)`
              : ''}
          </Text>
        </Text>
      )}
      renderPreview={command => (
        <Text dimColor>
          {isQueuedCommandEditable(command)
            ? 'Enter edits this prompt atomically. n sends it now.'
            : 'System-generated queue items are read-only.'}
        </Text>
      )}
      extraHints={
        <>
          <KeyboardShortcutHint shortcut="n" action="send now" />
          <KeyboardShortcutHint shortcut="d" action="remove" />
          <KeyboardShortcutHint shortcut="ctrl+↑/↓" action="reorder" />
        </>
      }
    />
  )
}
