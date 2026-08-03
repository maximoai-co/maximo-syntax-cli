import Fuse from 'fuse.js'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { getCommandName, isCommandEnabled, type Command } from '../commands.js'
import { useRegisterOverlay } from '../context/overlayContext.js'
import { Text } from '../ink.js'
import { useEscapePriority } from '../interaction/EscapePriority.js'
import { INTERACTION_PRIORITY } from '../interaction/interactionPriority.js'
import {
  ACTION_REGISTRY,
  type ActionDefinition,
} from '../keybindings/actionRegistry.js'
import {
  useOptionalKeybindingContext,
  useRegisterKeybindingContext,
} from '../keybindings/KeybindingContext.js'
import { FuzzyPicker } from './design-system/FuzzyPicker.js'

type PaletteItem =
  | { kind: 'action'; action: ActionDefinition }
  | { kind: 'command'; command: Command }

type Props = {
  commands: readonly Command[]
  onAction: (action: string) => void
  onCommand: (command: Command) => void
  onDone: () => void
}

function keyOf(item: PaletteItem): string {
  return item.kind === 'action'
    ? `action:${item.action.id}`
    : `command:${getCommandName(item.command)}`
}

export function CommandPalette({
  commands,
  onAction,
  onCommand,
  onDone,
}: Props): React.ReactNode {
  useRegisterOverlay('command-palette', true)
  useRegisterKeybindingContext('CommandPalette', true)
  useEscapePriority('command-palette', onDone, INTERACTION_PRIORITY.commandPalette)
  const keybindings = useOptionalKeybindingContext()
  const allItems = useMemo<PaletteItem[]>(() => {
    const actions = ACTION_REGISTRY.filter(action =>
      keybindings?.hasActionHandler(action.id),
    ).map(action => ({ kind: 'action' as const, action }))
    const commandItems = commands
      .filter(
        command =>
          !command.isHidden &&
          command.userInvocable !== false &&
          isCommandEnabled(command),
      )
      .map(command => ({ kind: 'command' as const, command }))
    return [...actions, ...commandItems]
  }, [commands, keybindings])
  const fuse = useMemo(
    () =>
      new Fuse(allItems, {
        threshold: 0.35,
        ignoreLocation: true,
        keys: [
          'action.title',
          'action.description',
          'action.category',
          'action.keywords',
          'command.name',
          'command.aliases',
          'command.description',
        ],
      }),
    [allItems],
  )
  const [items, setItems] = useState(allItems)

  return (
    <FuzzyPicker
      title="Command palette"
      placeholder="Search actions, commands, and skills…"
      items={items}
      getKey={keyOf}
      onQueryChange={query =>
        setItems(query.trim() ? fuse.search(query).map(result => result.item) : allItems)
      }
      onSelect={item => {
        if (item.kind === 'action') onAction(item.action.id)
        else onCommand(item.command)
      }}
      onCancel={onDone}
      selectAction="run"
      renderItem={(item, focused) => {
        if (item.kind === 'command') {
          return (
            <Text color={focused ? 'suggestion' : undefined}>
              /{getCommandName(item.command)}{' '}
              <Text dimColor>{item.command.description}</Text>
            </Text>
          )
        }
        const shortcut = keybindings?.getDisplayText(
          item.action.id,
          item.action.context as never,
        )
        return (
          <Text color={focused ? 'suggestion' : undefined}>
            {item.action.title}{' '}
            <Text dimColor>
              {item.action.category}
              {shortcut ? ` · ${shortcut}` : ''}
            </Text>
          </Text>
        )
      }}
      renderPreview={item => (
        <Text dimColor>
          {item.kind === 'action'
            ? item.action.description
            : item.command.whenToUse ?? item.command.description}
        </Text>
      )}
    />
  )
}
