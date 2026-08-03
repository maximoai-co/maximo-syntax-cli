/**
 * One priority table for keyboard, mouse, overlays, selection, and Escape.
 * Higher layers always get the first opportunity to consume an interaction.
 */
export const INTERACTION_PRIORITY = {
  emergency: 1000,
  permission: 920,
  modal: 900,
  commandPalette: 880,
  queue: 870,
  selection: 800,
  messageActions: 750,
  autocomplete: 700,
  transcript: 600,
  prompt: 500,
  global: 0,
} as const

const CONTEXT_PRIORITIES: Record<string, number> = {
  Confirmation: INTERACTION_PRIORITY.permission,
  CommandPalette: INTERACTION_PRIORITY.commandPalette,
  Queue: INTERACTION_PRIORITY.queue,
  MessageSelector: INTERACTION_PRIORITY.messageActions,
  Autocomplete: INTERACTION_PRIORITY.autocomplete,
  HistorySearch: INTERACTION_PRIORITY.autocomplete,
  Transcript: INTERACTION_PRIORITY.transcript,
  Scroll: INTERACTION_PRIORITY.transcript,
  Chat: INTERACTION_PRIORITY.prompt,
  Global: INTERACTION_PRIORITY.global,
}

export function sortInteractionContexts<T extends string>(
  contexts: readonly T[],
): T[] {
  return [...new Set(contexts)].sort(
    (a, b) =>
      (CONTEXT_PRIORITIES[b] ?? INTERACTION_PRIORITY.modal) -
      (CONTEXT_PRIORITIES[a] ?? INTERACTION_PRIORITY.modal),
  )
}

export type EscapeTarget = {
  id: string
  priority: number
  dismiss: () => void
}

export function pickEscapeTarget(
  targets: readonly EscapeTarget[],
): EscapeTarget | undefined {
  return targets.reduce<EscapeTarget | undefined>(
    (best, target) => (!best || target.priority > best.priority ? target : best),
    undefined,
  )
}
