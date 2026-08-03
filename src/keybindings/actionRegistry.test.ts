import { describe, expect, test } from 'bun:test'
import { ACTION_REGISTRY, getActionDefinition } from './actionRegistry.js'
import { KEYBINDING_ACTIONS } from './schema.js'

describe('action registry', () => {
  test('contains every keybinding action exactly once', () => {
    expect(ACTION_REGISTRY.map(action => action.id)).toEqual([
      ...KEYBINDING_ACTIONS,
    ])
    expect(new Set(ACTION_REGISTRY.map(action => action.id)).size).toBe(
      ACTION_REGISTRY.length,
    )
  })

  test('exposes palette metadata for the new global actions', () => {
    expect(getActionDefinition('app:commandPalette')).toMatchObject({
      context: 'Global',
      category: 'Application',
    })
    expect(getActionDefinition('app:queue')).toMatchObject({
      context: 'Global',
      category: 'Queue',
    })
  })
})
