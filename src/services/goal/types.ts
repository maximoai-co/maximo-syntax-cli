/**
 * Goal mode types — ported from Grok Build's GoalTracker state machine.
 * Pure data shapes; no I/O.
 */

export type GoalPhase = 'idle' | 'planning' | 'executing'

export type GoalStatus =
  | 'active'
  | 'user_paused'
  | 'back_off_paused'
  | 'no_progress_paused'
  | 'infra_paused'
  | 'blocked'
  | 'budget_limited'
  | 'complete'

export type GoalPauseReason =
  | 'user'
  | 'back_off'
  | 'no_progress'
  | 'verification'
  | 'infra'

export type GoalEvent =
  | 'goal_created'
  | 'planning_started'
  | 'planning_completed'
  | 'planning_failed'
  | 'worker_started'
  | 'worker_completed'
  | 'worker_failed'
  | 'goal_paused'
  | 'goal_resumed'
  | 'goal_completed'
  | 'goal_cleared'
  | 'budget_exceeded'
  | 'premature_stop_detected'
  | 'verification_started'
  | 'verification_passed'
  | 'verification_failed'
  | 'evaluator_continue'
  | 'evaluator_candidate_complete'
  | 'evaluator_blocked'

export type GoalHistoryEntry = {
  timestamp: string
  event: GoalEvent
  detail?: string
  round?: number
  tokensUsed?: number
  unmet?: string[]
}

export type GoalOrchestration = {
  goalId: string
  objective: string
  status: GoalStatus
  phase: GoalPhase
  tokenBudget: number | null
  tokensBaseline: number
  tokensUsed: number
  elapsedMs: number
  createdAt: string
  planText: string | null
  planPath: string | null
  scratchDir: string | null
  totalWorkerRounds: number
  totalVerifyRounds: number
  classifierRunsAttempted: number
  classifierMaxRuns: number
  consecutiveNotAchieved: number
  consecutiveSameGaps: number
  lastGapFingerprint: string | null
  lastClassifierGaps: string | null
  lastClassifierDetails: string | null
  lastEvaluatorNextStep: string | null
  lastEvaluatorEvidence: string | null
  evaluatorBlockerKey: string | null
  evaluatorBlockerStreak: number
  pauseMessage: string | null
  verifyingInFlight: boolean
  planningInFlight: boolean
  history: GoalHistoryEntry[]
  /** Session-local wall-clock anchor for elapsed accounting */
  _elapsedAnchorMs: number
}

export type GoalEvaluatorDecision =
  | 'continue'
  | 'candidate_complete'
  | 'blocked'

export type GoalEvaluatorVerdict = {
  decision: GoalEvaluatorDecision
  evidence: string
  nextStep: string
  blockerKey: string
}

export type GoalVerifierVerdict = {
  refuted: boolean
  blocking: 'none' | 'user_action' | 'unverifiable'
  gapsSummary: string
  evidence: string
  gapFingerprint: string
}

export type GoalRoundDecision =
  | { action: 'continue'; directive: string; statusMessage: string }
  | { action: 'complete'; statusMessage: string }
  | { action: 'pause'; statusMessage: string }
  | { action: 'end_turn'; statusMessage?: string }

export const GOAL_EVALUATOR_MODEL = 'maximo-pandora-3.8-nano'
export const GOAL_CLASSIFIER_MAX_RUNS_DEFAULT = 6
export const GOAL_EVALUATOR_BLOCKER_STREAK = 3
export const GOAL_STALL_THRESHOLD = 2
export const GOAL_EVALUATOR_TIMEOUT_MS = 30_000
export const GOAL_VERIFIER_TIMEOUT_MS = 90_000
export const GOAL_HISTORY_MAX = 64
export const GOAL_TRANSCRIPT_MAX_CHARS = 32 * 1024
export const GOAL_ITEM_MAX_CHARS = 4 * 1024
