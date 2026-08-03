import { useEffect } from 'react'
import type { InputEvent } from '../ink/events/input-event.js'
import { useInput } from '../ink.js'
import {
  INTERACTION_PRIORITY,
  pickEscapeTarget,
  type EscapeTarget,
} from './interactionPriority.js'

const targets = new Map<string, EscapeTarget>()

export function useEscapePriority(
  id: string,
  dismiss: () => void,
  priority: number = INTERACTION_PRIORITY.modal,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    targets.set(id, { id, dismiss, priority })
    return () => {
      if (targets.get(id)?.dismiss === dismiss) targets.delete(id)
    }
  }, [dismiss, enabled, id, priority])
}

/** Mounted once above feature handlers so one Escape dismisses one top layer. */
export function EscapePriorityHandler(): null {
  useInput((_, key, event: InputEvent) => {
    if (!key.escape) return
    const target = pickEscapeTarget([...targets.values()])
    if (!target) return
    event.stopImmediatePropagation()
    target.dismiss()
  })
  return null
}

