/**
 * Side-channel for auto-mode / bash classifier permission decisions.
 *
 * Interactive TUI reads classifierApprovals in-memory; stream-json hosts
 * (desktop, SDK) need a serializable event so they can show "allowed/denied
 * by classifier" next to each tool use.
 */

export type ClassifierDecisionEvent = {
  toolUseId: string
  toolName: string
  decision: 'allowed' | 'denied'
  /** e.g. "auto-mode", "bash", "bash_allow" */
  classifier: string
  reason?: string
}

export type ClassifierDecisionHandler = (
  event: ClassifierDecisionEvent,
) => void

const MAX_PENDING = 50
const pending: ClassifierDecisionEvent[] = []
let handler: ClassifierDecisionHandler | null = null

export function registerClassifierDecisionHandler(
  next: ClassifierDecisionHandler | null,
): void {
  handler = next
  if (handler && pending.length > 0) {
    for (const event of pending.splice(0)) {
      handler(event)
    }
  }
}

export function emitClassifierDecision(event: ClassifierDecisionEvent): void {
  if (!event.toolUseId || !event.toolName) return
  if (handler) {
    handler(event)
    return
  }
  pending.push(event)
  if (pending.length > MAX_PENDING) pending.shift()
}

export function clearClassifierDecisionHandler(): void {
  handler = null
  pending.length = 0
}
