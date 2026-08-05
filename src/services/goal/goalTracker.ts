/**
 * GoalTracker — pure state machine for autonomous goal mode.
 * Modeled after Grok Build's GoalTracker (no async I/O here).
 */

import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  GOAL_CLASSIFIER_MAX_RUNS_DEFAULT,
  GOAL_HISTORY_MAX,
  GOAL_STALL_THRESHOLD,
  type GoalEvent,
  type GoalHistoryEntry,
  type GoalOrchestration,
  type GoalPauseReason,
  type GoalPhase,
  type GoalStatus,
} from './types.js'

type Listener = () => void

let current: GoalOrchestration | null = null
const listeners = new Set<Listener>()

function nowIso(): string {
  return new Date().toISOString()
}

function historyEntry(
  event: GoalEvent,
  detail?: string,
  extra?: Partial<Pick<GoalHistoryEntry, 'round' | 'tokensUsed' | 'unmet'>>,
): GoalHistoryEntry {
  return {
    timestamp: nowIso(),
    event,
    ...(detail ? { detail } : {}),
    ...extra,
  }
}

function notify(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      // ignore subscriber errors
    }
  }
}

function appendHistory(entry: GoalHistoryEntry): void {
  if (!current) return
  current.history = [...current.history, entry].slice(-GOAL_HISTORY_MAX)
}

function pauseReasonToStatus(reason: GoalPauseReason): GoalStatus {
  switch (reason) {
    case 'user':
      return 'user_paused'
    case 'back_off':
      return 'back_off_paused'
    case 'no_progress':
      return 'no_progress_paused'
    case 'verification':
      return 'blocked'
    case 'infra':
      return 'infra_paused'
  }
}

function pauseHistoryDetail(reason: GoalPauseReason): string {
  switch (reason) {
    case 'user':
      return 'user'
    case 'back_off':
      return 'back_off'
    case 'no_progress':
      return 'no_progress'
    case 'verification':
      return 'blocked'
    case 'infra':
      return 'infra'
  }
}

export function isGoalPausedStatus(status: GoalStatus): boolean {
  return (
    status === 'user_paused' ||
    status === 'back_off_paused' ||
    status === 'no_progress_paused' ||
    status === 'infra_paused' ||
    status === 'blocked'
  )
}

export function isGoalActive(): boolean {
  return current?.status === 'active'
}

export function hasGoal(): boolean {
  return current !== null
}

export function getGoalSnapshot(): GoalOrchestration | null {
  return current
}

export function subscribeGoal(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getGoalStatusSnapshot(): {
  status: GoalStatus
  phase: GoalPhase
  objective: string
  tokensUsed: number
  tokenBudget: number | null
  totalWorkerRounds: number
  totalVerifyRounds: number
  pauseMessage: string | null
} | null {
  if (!current) return null
  accountElapsed()
  return {
    status: current.status,
    phase: current.phase,
    objective: current.objective,
    tokensUsed: current.tokensUsed,
    tokenBudget: current.tokenBudget,
    totalWorkerRounds: current.totalWorkerRounds,
    totalVerifyRounds: current.totalVerifyRounds,
    pauseMessage: current.pauseMessage,
  }
}

function makeScratchDir(goalId: string): string {
  const dir = join(tmpdir(), `maximo-goal-${goalId}`)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // best-effort; implementer can still work without scratch
  }
  return dir
}

export function createGoal(
  objective: string,
  options?: {
    tokenBudget?: number | null
    tokensBaseline?: number
    planText?: string | null
  },
): GoalOrchestration {
  const goalId = randomUUID().slice(0, 8)
  const scratchDir = makeScratchDir(goalId)
  current = {
    goalId,
    objective: objective.trim(),
    status: 'active',
    phase: 'planning',
    tokenBudget: options?.tokenBudget ?? null,
    tokensBaseline: options?.tokensBaseline ?? 0,
    tokensUsed: 0,
    elapsedMs: 0,
    createdAt: nowIso(),
    planText: options?.planText ?? null,
    planPath: null,
    scratchDir,
    totalWorkerRounds: 0,
    totalVerifyRounds: 0,
    classifierRunsAttempted: 0,
    classifierMaxRuns: GOAL_CLASSIFIER_MAX_RUNS_DEFAULT,
    consecutiveNotAchieved: 0,
    consecutiveSameGaps: 0,
    lastGapFingerprint: null,
    lastClassifierGaps: null,
    lastClassifierDetails: null,
    lastEvaluatorNextStep: null,
    lastEvaluatorEvidence: null,
    evaluatorBlockerKey: null,
    evaluatorBlockerStreak: 0,
    pauseMessage: null,
    verifyingInFlight: false,
    planningInFlight: true,
    history: [historyEntry('goal_created', objective.trim().slice(0, 200))],
    _elapsedAnchorMs: Date.now(),
  }
  appendHistory(historyEntry('planning_started'))
  notify()
  return current
}

export function setPlan(
  planText: string,
  planPath?: string | null,
): void {
  if (!current) return
  current.planText = planText
  current.planPath = planPath ?? null
  current.planningInFlight = false
  current.phase = 'executing'
  appendHistory(historyEntry('planning_completed'))
  notify()
}

export function markPlanningFailed(detail: string): void {
  if (!current) return
  current.planningInFlight = false
  current.phase = 'executing'
  appendHistory(historyEntry('planning_failed', detail.slice(0, 500)))
  notify()
}

export function accountElapsed(): void {
  if (!current || current.status !== 'active') return
  const now = Date.now()
  current.elapsedMs += Math.max(0, now - current._elapsedAnchorMs)
  current._elapsedAnchorMs = now
}

export function updateTokensUsed(totalTokens: number): void {
  if (!current) return
  current.tokensUsed = Math.max(0, totalTokens - current.tokensBaseline)
}

export function recordWorkerRound(
  detail: string,
  failed = false,
): void {
  if (!current) return
  current.totalWorkerRounds += 1
  appendHistory(
    historyEntry(failed ? 'worker_failed' : 'worker_completed', detail.slice(0, 500), {
      round: current.totalWorkerRounds,
      tokensUsed: current.tokensUsed,
    }),
  )
  notify()
}

export function recordEvaluatorContinue(evidence: string, nextStep: string): void {
  if (!current) return
  current.evaluatorBlockerKey = null
  current.evaluatorBlockerStreak = 0
  current.lastEvaluatorEvidence = evidence
  current.lastEvaluatorNextStep = nextStep
  appendHistory(historyEntry('evaluator_continue', evidence.slice(0, 500)))
  notify()
}

export function recordEvaluatorCandidateComplete(
  evidence: string,
  nextStep: string,
): void {
  if (!current) return
  current.evaluatorBlockerKey = null
  current.evaluatorBlockerStreak = 0
  current.lastEvaluatorEvidence = evidence
  current.lastEvaluatorNextStep = nextStep
  appendHistory(
    historyEntry('evaluator_candidate_complete', evidence.slice(0, 500)),
  )
  notify()
}

/**
 * Returns the new streak count for this blocker key.
 */
export function recordEvaluatorBlocked(
  blockerKey: string,
  evidence: string,
  nextStep: string,
): number {
  if (!current) return 0
  const key = blockerKey.trim()
  if (current.evaluatorBlockerKey === key) {
    current.evaluatorBlockerStreak += 1
  } else {
    current.evaluatorBlockerKey = key
    current.evaluatorBlockerStreak = 1
  }
  current.lastEvaluatorEvidence = evidence
  current.lastEvaluatorNextStep = nextStep
  appendHistory(
    historyEntry('evaluator_blocked', `${key}: ${evidence}`.slice(0, 500)),
  )
  notify()
  return current.evaluatorBlockerStreak
}

export function resetEvaluatorBlocker(): void {
  if (!current) return
  current.evaluatorBlockerKey = null
  current.evaluatorBlockerStreak = 0
}

export function beginVerification(): number {
  if (!current) return 0
  current.verifyingInFlight = true
  current.classifierRunsAttempted += 1
  current.totalVerifyRounds += 1
  appendHistory(
    historyEntry('verification_started', undefined, {
      round: current.classifierRunsAttempted,
    }),
  )
  notify()
  return current.classifierRunsAttempted
}

export function endVerification(): void {
  if (!current) return
  current.verifyingInFlight = false
  notify()
}

export function recordVerificationPassed(detail?: string): void {
  if (!current) return
  current.verifyingInFlight = false
  current.lastClassifierGaps = null
  current.lastGapFingerprint = null
  current.consecutiveSameGaps = 0
  current.consecutiveNotAchieved = 0
  appendHistory(historyEntry('verification_passed', detail?.slice(0, 500)))
  notify()
}

/**
 * Returns true when the same gap fingerprint has stalled past threshold.
 */
export function recordVerificationFailed(
  gapsSummary: string,
  gapFingerprint: string,
  details?: string,
): boolean {
  if (!current) return false
  current.verifyingInFlight = false
  current.lastClassifierGaps = gapsSummary
  current.lastClassifierDetails = details ?? null
  current.consecutiveNotAchieved += 1
  if (gapFingerprint && gapFingerprint === current.lastGapFingerprint) {
    current.consecutiveSameGaps += 1
  } else {
    current.lastGapFingerprint = gapFingerprint || null
    current.consecutiveSameGaps = gapFingerprint ? 1 : 0
  }
  appendHistory(
    historyEntry('verification_failed', gapsSummary.slice(0, 500), {
      unmet: gapsSummary
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 12),
    }),
  )
  notify()
  return (
    current.consecutiveSameGaps >= GOAL_STALL_THRESHOLD &&
    gapFingerprint.length > 0
  )
}

export function rollbackClassifierAttempt(): void {
  if (!current) return
  if (current.classifierRunsAttempted > 0) {
    current.classifierRunsAttempted -= 1
  }
}

export function completeGoal(detail?: string): void {
  if (!current) return
  accountElapsed()
  current.status = 'complete'
  current.phase = 'idle'
  current.verifyingInFlight = false
  current.planningInFlight = false
  current.pauseMessage = null
  appendHistory(historyEntry('goal_completed', detail?.slice(0, 500)))
  notify()
}

export function pauseGoal(
  reason: GoalPauseReason,
  message?: string,
): boolean {
  if (!current || current.status !== 'active') return false
  accountElapsed()
  current.status = pauseReasonToStatus(reason)
  current.verifyingInFlight = false
  current.planningInFlight = false
  current.pauseMessage = message ?? null
  appendHistory(
    historyEntry('goal_paused', pauseHistoryDetail(reason), {
      unmet: message
        ? message
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 8)
        : undefined,
    }),
  )
  notify()
  return true
}

export function resumeGoal(): boolean {
  if (!current || !isGoalPausedStatus(current.status)) return false
  if (current.status === 'complete' || current.status === 'budget_limited') {
    return false
  }
  current.status = 'active'
  current.phase = current.planText ? 'executing' : 'planning'
  current.pauseMessage = null
  current.consecutiveSameGaps = 0
  current.lastGapFingerprint = null
  current.evaluatorBlockerKey = null
  current.evaluatorBlockerStreak = 0
  current._elapsedAnchorMs = Date.now()
  appendHistory(historyEntry('goal_resumed'))
  notify()
  return true
}

export function markBudgetLimited(tokensUsed: number): void {
  if (!current) return
  accountElapsed()
  current.status = 'budget_limited'
  current.tokensUsed = tokensUsed
  current.verifyingInFlight = false
  appendHistory(
    historyEntry('budget_exceeded', `tokens=${tokensUsed}`, {
      tokensUsed,
    }),
  )
  notify()
}

export function recordPrematureStop(pattern: string): void {
  if (!current) return
  appendHistory(historyEntry('premature_stop_detected', pattern))
  notify()
}

export function clearGoal(): GoalOrchestration | null {
  if (!current) return null
  accountElapsed()
  const snap = current
  appendHistory(historyEntry('goal_cleared'))
  // Keep one last notify with cleared event, then null out
  notify()
  current = null
  notify()
  return snap
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatGoalStatusText(): string {
  if (!current) {
    return 'No active goal. Use `/goal <objective>` to set one.'
  }
  accountElapsed()
  const g = current
  const budget =
    g.tokenBudget !== null
      ? `${g.tokensUsed.toLocaleString()} / ${g.tokenBudget.toLocaleString()} tokens`
      : `${g.tokensUsed.toLocaleString()} tokens (no budget)`
  const lines = [
    `Goal: ${g.objective}`,
    `Status: ${g.status} | Phase: ${g.phase}`,
    `Rounds: ${g.totalWorkerRounds} work / ${g.totalVerifyRounds} verify`,
    `Tokens: ${budget}`,
    `Elapsed: ${formatElapsed(g.elapsedMs)}`,
    `ID: ${g.goalId}`,
  ]
  if (g.pauseMessage) {
    lines.push(`Pause reason: ${g.pauseMessage}`)
  }
  if (g.lastClassifierGaps) {
    lines.push(`Outstanding gaps:\n${g.lastClassifierGaps}`)
  }
  if (g.lastEvaluatorNextStep && g.status === 'active') {
    lines.push(`Next step: ${g.lastEvaluatorNextStep}`)
  }
  return lines.join('\n')
}
