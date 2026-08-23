import type { Message } from '../../types/message.js'

/**
 * Conversation-turn slicing for "summary + recent tail" compaction.
 *
 * Groups messages into human turns (boundaries at real user prompts, not
 * tool_results) and selects the trailing N complete turns to keep verbatim
 * alongside a compaction summary. Everything before the kept tail gets
 * summarized.
 *
 * Turn boundaries land only on genuine user prompts — messages whose content
 * is text/string (or blocks without tool_result items) and that are not meta
 * markers, compact summaries, or virtual. This keeps every assistant
 * tool_use block together with its user-embedded tool_result by
 * construction: those results belong to the same turn as the prompt that
 * started them, and a boundary can never fire between them.
 */
export type TailTurnSelection = {
  /** Messages to keep verbatim after the summary. Empty = summary-only. */
  kept: Message[]
  /** Number of messages that will be covered by the summary. */
  summarizedCount: number
}

/** A user message that is a real prompt (not a meta/tool_result/synthetic). */
function isRealUserPrompt(message: Message): boolean {
  if (message.type !== 'user') {
    return false
  }
  if (
    message.isMeta ||
    message.isCompactSummary ||
    message.isVisibleInTranscriptOnly ||
    message.isVirtual
  ) {
    return false
  }
  const content = message.message.content
  if (typeof content === 'string') {
    return true
  }
  return Array.isArray(content) &&
    !content.some(block => block.type === 'tool_result')
}

function turnContainsUnansweredMedia(messages: Message[]): boolean {
  // Mirrors shouldPreserveUnansweredTurn semantics at turn granularity: an
  // image/document inside this turn whose pixels would be separated from
  // their question if the turn were ever summarized. For KEPT turns media
  // survives verbatim, so this check only matters for callers that might
  // drop or summarize part of the tail — we surface it so compactConversation
  // can bail out to summary-only when the tail itself is unsafe to slice.
  let sawAssistant = false
  for (const message of messages) {
    if (message.type === 'assistant') {
      sawAssistant = true
      continue
    }
    if (!sawAssistant || message.type !== 'user' || typeof message.message.content === 'string') {
      continue
    }
    const hasMedia = (message.message.content as Array<{ type?: string }>).some(
      block => block?.type === 'image' || block?.type === 'document',
    )
    if (hasMedia) {
      return true
    }
  }
  return false
}

/**
 * Select the last `keepTurns` complete conversation turns to preserve
 * verbatim across a compaction.
 *
 * Bails out (returns empty `kept` → caller falls back to plain summary-only
 * compaction) when:
 * - fewer than two turn groups exist (nothing meaningful to summarize),
 * - keeping the tail would leave less than one full turn to summarize,
 * - the tail would swallow ≥60% of all messages (compaction would barely
 *   reclaim anything), or
 * - the tail contains an unanswered-media turn (unsafe to detach).
 */
export function selectTailTurns(
  messages: Message[],
  keepTurns = 3,
): TailTurnSelection {
  const groups: Message[][] = []
  let current: Message[] = []
  for (const message of messages) {
    if (isRealUserPrompt(message) && current.length > 0) {
      groups.push(current)
      current = [message]
    } else {
      current.push(message)
    }
  }
  if (current.length > 0) {
    groups.push(current)
  }

  // Need at least one group to summarize plus one to keep.
  if (groups.length < 2) {
    return { kept: [], summarizedCount: messages.length }
  }

  const keepGroupCount = Math.min(keepTurns, groups.length - 1)
  const keptGroups = groups.slice(groups.length - keepGroupCount)
  const summarizedGroups = groups.slice(0, groups.length - keepGroupCount)

  const kept: Message[] = keptGroups.flat()
  const summarizedCount = summarizedGroups.reduce(
    (sum, group) => sum + group.length,
    0,
  )

  // Compaction must meaningfully shrink the conversation; otherwise keep the
  // legacy behavior (full summarize) rather than churning tokens on a
  // near-no-op boundary.
  if (summarizedCount < 1 || kept.length > messages.length * 0.6) {
    return { kept: [], summarizedCount: messages.length }
  }

  if (turnContainsUnansweredMedia(kept)) {
    return { kept: [], summarizedCount: messages.length }
  }

  return { kept, summarizedCount }
}
