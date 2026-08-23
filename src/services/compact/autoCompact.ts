import { feature } from 'bun:bundle'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getSdkBetas } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { getGlobalConfig } from '../../utils/config.js'
import {
  getCompactSummaryMaxOutputTokensForModel,
  getContextWindowForModel,
} from '../../utils/context.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getCachedMaximoModelLimits } from '../api/maximoModels.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_USER_ABORT,
  type RecompactionInfo,
} from './compact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'
import { trySessionMemoryCompaction } from './sessionMemoryCompact.js'

// Returns the context window size minus the max output tokens for the model
export function getEffectiveContextWindowSize(model: string): number {
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  const autoCompactWindow = process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  const reservedTokensForSummary =
    getCompactSummaryMaxOutputTokensForModel(model, contextWindow)

  return Math.max(0, contextWindow - reservedTokensForSummary)
}

// Auto-compact triggers at this percentage of the model's max context window.
// Precedence: MAXIMO_SYNTAX_AUTOCOMPACT_PCT env (set per-spawn by the desktop
// app from its settings UI) > global config autoCompactPercent > default.
export const AUTOCOMPACT_DEFAULT_PERCENT = 40
const AUTOCOMPACT_MIN_PERCENT = 10
const AUTOCOMPACT_MAX_PERCENT = 70

function clampAutoCompactPercent(value: number): number {
  if (!Number.isFinite(value)) return AUTOCOMPACT_DEFAULT_PERCENT
  return Math.min(
    AUTOCOMPACT_MAX_PERCENT,
    Math.max(AUTOCOMPACT_MIN_PERCENT, Math.floor(value)),
  )
}

export function getAutoCompactPercent(): number {
  const envPercent = process.env.MAXIMO_SYNTAX_AUTOCOMPACT_PCT
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      return clampAutoCompactPercent(parsed)
    }
  }
  const configured = getGlobalConfig().autoCompactPercent
  if (typeof configured === 'number') {
    return clampAutoCompactPercent(configured)
  }
  return AUTOCOMPACT_DEFAULT_PERCENT
}

export type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  // Unique ID per turn
  turnId: string
  // Consecutive autocompact failures. Reset on success.
  // Used as a circuit breaker to stop retrying when the context is
  // irrecoverably over the limit (e.g., prompt_too_long).
  consecutiveFailures?: number
}

// Fallback buffers for warning/error proximity indicators.
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000

// Stop trying autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
let skipInitialAutoCompact = isEnvTruthy(
  process.env.MAXIMO_SYNTAX_SKIP_FIRST_AUTOCOMPACT,
)

function getMaximoOutputRatio(model: string): number | undefined {
  const limits = getCachedMaximoModelLimits(model)
  if (!limits?.contextWindow || !limits.maxOutputTokens) {
    return undefined
  }
  return Math.min(1, limits.maxOutputTokens / limits.contextWindow)
}

function getThresholdBufferTokens(
  model: string,
  threshold: number,
  fallback: number,
): number {
  const outputRatio = getMaximoOutputRatio(model)
  if (outputRatio === undefined) {
    return fallback
  }
  return Math.floor(Math.min(threshold, threshold * outputRatio))
}

export function getAutoCompactThreshold(model: string): number {
  let contextWindow = getContextWindowForModel(model, getSdkBetas())

  const autoCompactWindow = process.env.MAXIMO_SYNTAX_AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  // Threshold is a straight percentage of the model's max context window so
  // compaction fires well before the window fills — leaving headroom for the
  // summary output and post-compact re-injections.
  return Math.max(0, Math.floor(contextWindow * (getAutoCompactPercent() / 100)))
}

export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

  const percentLeft =
    threshold > 0
      ? Math.max(0, Math.round(((threshold - tokenUsage) / threshold) * 100))
      : 0

  const warningThreshold =
    threshold -
    getThresholdBufferTokens(model, threshold, WARNING_THRESHOLD_BUFFER_TOKENS)
  const errorThreshold =
    threshold -
    getThresholdBufferTokens(model, threshold, ERROR_THRESHOLD_BUFFER_TOKENS)

  const isAboveWarningThreshold = tokenUsage >= warningThreshold
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    isAutoCompactEnabled() && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model)
  const defaultBlockingLimit = Math.max(
    0,
    actualContextWindow -
      getThresholdBufferTokens(
        model,
        actualContextWindow,
        MANUAL_COMPACT_BUFFER_TOKENS,
      ),
  )

  // Allow override for testing
  const blockingLimitOverride = process.env.MAXIMO_SYNTAX_BLOCKING_LIMIT_OVERRIDE
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}

export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  // Allow disabling just auto-compact (keeps manual /compact working)
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  // Check if user has disabled auto-compact in their settings
  const userConfig = getGlobalConfig()
  return userConfig.autoCompactEnabled
}

function contentContainsMedia(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false
  }

  return content.some(block => {
    if (!block || typeof block !== 'object') {
      return false
    }
    const typedBlock = block as {
      type?: string
      content?: unknown
    }
    if (typedBlock.type === 'image' || typedBlock.type === 'document') {
      return true
    }
    return (
      typedBlock.type === 'tool_result' &&
      contentContainsMedia(typedBlock.content)
    )
  })
}

/**
 * Auto-compaction replaces image blocks with "[image]" before asking the
 * summarizer to compact the transcript. If the latest image has not received
 * an assistant response yet, compacting here permanently separates the user's
 * question from the actual pixels and can turn text visible in the image into
 * invented follow-up work.
 *
 * A first turn is also never useful to summarize: there is no conversation
 * history to reduce. Let the normal API path handle it verbatim.
 */
export function shouldPreserveUnansweredTurn(
  messages: readonly Message[],
): boolean {
  let lastAssistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.type === 'assistant') {
      lastAssistantIndex = index
      break
    }
  }

  if (lastAssistantIndex === -1) {
    return true
  }

  return messages.slice(lastAssistantIndex + 1).some(message => {
    if (message.type !== 'user') {
      return false
    }
    return contentContainsMedia(message.message.content)
  })
}

export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
): Promise<boolean> {
  // Recursion guards. session_memory and compact are forked agents that
  // would deadlock.
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }
  // marble_origami is the ctx-agent — if ITS context blows up and
  // autocompact fires, runPostCompactCleanup calls resetContextCollapse()
  // which destroys the MAIN thread's committed log (module-level state
  // shared across forks). Inside feature() so the string DCEs from
  // external builds (it's in excluded-strings.txt).
  if (feature('CONTEXT_COLLAPSE')) {
    if (querySource === 'marble_origami') {
      return false
    }
  }

  if (!isAutoCompactEnabled()) {
    return false
  }

  if (shouldPreserveUnansweredTurn(messages)) {
    return false
  }

  // Reactive-only mode: suppress proactive autocompact, let reactive compact
  // catch the API's prompt-too-long. feature() wrapper keeps the flag string
  // out of external builds (REACTIVE_COMPACT is ant-only).
  // Note: returning false here also means autoCompactIfNeeded never reaches
  // trySessionMemoryCompaction in the query loop — the /compact call site
  // still tries session memory first. Revisit if reactive-only graduates.
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      return false
    }
  }

  // Context-collapse mode: same suppression. Collapse IS the context
  // management system when it's on — the 90% commit / 95% blocking-spawn
  // flow owns the headroom problem. Autocompact firing at effective-13k
  // (~93% of effective) sits right between collapse's commit-start (90%)
  // and blocking (95%), so it would race collapse and usually win, nuking
  // granular context that collapse was about to save. Gating here rather
  // than in isAutoCompactEnabled() keeps reactiveCompact alive as the 413
  // fallback (it consults isAutoCompactEnabled directly) and leaves
  // sessionMemory + manual /compact working.
  //
  // Consult isContextCollapseEnabled (not the raw gate) so the
  // CLAUDE_CONTEXT_COLLAPSE env override is honored here too. require()
  // inside the block breaks the init-time cycle (this file exports
  // getEffectiveContextWindowSize which collapse's index imports).
  if (feature('CONTEXT_COLLAPSE')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isContextCollapseEnabled } =
      require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isContextCollapseEnabled()) {
      return false
    }
  }

  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const threshold = getAutoCompactThreshold(model)
  const effectiveWindow = getEffectiveContextWindowSize(model)

  logForDebugging(
    `autocompact: tokens=${tokenCount} threshold=${threshold} effectiveWindow=${effectiveWindow}${snipTokensFreed > 0 ? ` snipFreed=${snipTokensFreed}` : ''}`,
  )

  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(
    tokenCount,
    model,
  )

  return isAboveAutoCompactThreshold
}

export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
}> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
  if (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  if (skipInitialAutoCompact) {
    skipInitialAutoCompact = false
    return { wasCompacted: false }
  }
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
  )

  if (!shouldCompact) {
    return { wasCompacted: false }
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model),
    querySource,
  }

  // EXPERIMENT: Try session memory compaction first.
  // Skipped when keep-tail compaction is active: compactConversation now
  // produces a deterministic "summary + last N turns" result that the UI and
  // resume relink are built around; SM's variable 10-40k tail contradicts
  // that contract. MAXIMO_SYNTAX_DISABLE_KEEP_TAIL_COMPACT restores the old
  // SM-first behavior instantly (kill switch).
  if (!isEnvTruthy(process.env.MAXIMO_SYNTAX_DISABLE_KEEP_TAIL_COMPACT)) {
    const sessionMemoryResult = await trySessionMemoryCompaction(
      messages,
      toolUseContext.agentId,
      recompactionInfo.autoCompactThreshold,
    )
    if (sessionMemoryResult) {
      // Reset lastSummarizedMessageId since session memory compaction prunes messages
      // and the old message UUID will no longer exist after the REPL replaces messages
      setLastSummarizedMessageId(undefined)
      runPostCompactCleanup(querySource)
      // Reset cache read baseline so the post-compact drop isn't flagged as a
      // break. compactConversation does this internally; SM-compact doesn't.
      // BQ 2026-03-01: missing this made 20% of tengu_prompt_cache_break events
      // false positives (systemPromptChanged=true, timeSinceLastAssistantMsg=-1).
      if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
        notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
      }
      markPostCompaction()
      return {
        wasCompacted: true,
        compactionResult: sessionMemoryResult,
      }
    }
  }

  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      cacheSafeParams,
      true, // Suppress user questions for autocompact
      undefined, // No custom instructions for autocompact
      true, // isAutoCompact
      recompactionInfo,
    )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure count on success
      consecutiveFailures: 0,
    }
  } catch (error) {
    if (!hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
      logError(error)
    }
    // Increment consecutive failure count for circuit breaker.
    // The caller threads this through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts.
    const prevFailures = tracking?.consecutiveFailures ?? 0
    const nextFailures = prevFailures + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures — skipping future attempts this session`,
        { level: 'warn' },
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
}
