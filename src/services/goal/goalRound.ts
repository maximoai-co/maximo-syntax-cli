/**
 * End-of-turn goal orchestration:
 * evaluate → (verify if candidate) → continue / pause / complete.
 */

import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import type { EffortValue } from '../../utils/effort.js'
import { getAssistantMessageText } from '../../utils/messages.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import {
  GOAL_BAIL_PREFACE,
  renderContinuationDirective,
} from './goalContinuation.js'
import { evaluateGoalRound } from './goalEvaluator.js'
import { detectPrematureStop } from './goalStopDetector.js'
import {
  accountElapsed,
  beginVerification,
  completeGoal,
  endVerification,
  getGoalSnapshot,
  isGoalActive,
  markBudgetLimited,
  pauseGoal,
  recordEvaluatorBlocked,
  recordEvaluatorCandidateComplete,
  recordEvaluatorContinue,
  recordPrematureStop,
  recordVerificationFailed,
  recordVerificationPassed,
  recordWorkerRound,
  rollbackClassifierAttempt,
  updateTokensUsed,
} from './goalTracker.js'
import { verifyGoalCandidate } from './goalVerifier.js'
import {
  GOAL_EVALUATOR_BLOCKER_STREAK,
  type GoalRoundDecision,
} from './types.js'

function latestAssistantText(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'assistant') {
      return getAssistantMessageText(m)
    }
  }
  return null
}

/**
 * Run after the main agent finishes a turn with no more tool calls.
 * Only acts when a goal is Active.
 */
export async function runGoalRoundEnd(params: {
  messages: readonly Message[]
  totalTokens: number
  effortValue: EffortValue | undefined
  activeModel?: string
  signal?: AbortSignal
}): Promise<GoalRoundDecision> {
  if (!isGoalActive()) {
    return { action: 'end_turn' }
  }

  const goal = getGoalSnapshot()
  if (!goal) {
    return { action: 'end_turn' }
  }

  accountElapsed()
  updateTokensUsed(params.totalTokens)

  // Token budget enforcement
  if (goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) {
    markBudgetLimited(goal.tokensUsed)
    return {
      action: 'pause',
      statusMessage: `Goal paused — token budget reached (${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()}). Use /goal resume after raising the budget or clearing with /goal clear.`,
    }
  }

  const activeModel = params.activeModel?.trim() || getMainLoopModel()
  const assistantText = latestAssistantText(params.messages)

  let verdict
  try {
    verdict = await evaluateGoalRound({
      messages: params.messages,
      objective: goal.objective,
      plan: goal.planText,
      activeModel,
      effortValue: params.effortValue,
      signal: params.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`[goal] evaluate failed: ${msg}`, { level: 'error' })
    recordWorkerRound(msg, true)
    pauseGoal(
      'infra',
      `Goal evaluation failed after a bounded retry: ${msg}. The goal was paused rather than treated as complete. Use /goal resume to retry.`,
    )
    return {
      action: 'pause',
      statusMessage: `Goal paused — evaluation failed: ${msg}\nUse /goal resume to retry.`,
    }
  }

  // Re-check: evaluation is async; user may have paused/cleared
  if (!isGoalActive()) {
    return { action: 'end_turn' }
  }

  switch (verdict.decision) {
    case 'continue': {
      recordEvaluatorContinue(verdict.evidence, verdict.nextStep)
      recordWorkerRound(verdict.evidence, false)
      return continueWithDirective(verdict.nextStep, assistantText, params.totalTokens)
    }
    case 'candidate_complete': {
      recordEvaluatorCandidateComplete(verdict.evidence, verdict.nextStep)
      recordWorkerRound(verdict.evidence, false)
      return await handleCandidateComplete({
        messages: params.messages,
        activeModel,
        effortValue: params.effortValue,
        totalTokens: params.totalTokens,
        assistantText,
        signal: params.signal,
      })
    }
    case 'blocked': {
      const streak = recordEvaluatorBlocked(
        verdict.blockerKey,
        verdict.evidence,
        verdict.nextStep,
      )
      recordWorkerRound(verdict.evidence, false)
      if (streak >= GOAL_EVALUATOR_BLOCKER_STREAK) {
        const pauseMsg = `${verdict.evidence}\nNext user action: ${verdict.nextStep}`
        pauseGoal('verification', pauseMsg)
        return {
          action: 'pause',
          statusMessage: `Goal paused — verification blocked.\nReason: ${verdict.evidence}\n\n${verdict.nextStep}\n\nType /goal resume after addressing it.`,
        }
      }
      // Keep going with the suggested next step while under streak threshold
      return continueWithDirective(
        verdict.nextStep,
        assistantText,
        params.totalTokens,
      )
    }
  }
}

async function handleCandidateComplete(params: {
  messages: readonly Message[]
  activeModel: string
  effortValue: EffortValue | undefined
  totalTokens: number
  assistantText: string | null
  signal?: AbortSignal
}): Promise<GoalRoundDecision> {
  const goal = getGoalSnapshot()
  if (!goal || !isGoalActive()) {
    return { action: 'end_turn' }
  }

  if (goal.classifierRunsAttempted >= goal.classifierMaxRuns) {
    pauseGoal(
      'back_off',
      `Goal classifier rejected completion ${goal.classifierRunsAttempted} times — goal auto-paused.`,
    )
    return {
      action: 'pause',
      statusMessage: `Goal paused — verification cap reached (${goal.classifierRunsAttempted}/${goal.classifierMaxRuns}). Review gaps with /goal status, then /goal resume.`,
    }
  }

  beginVerification()
  let vVerdict
  try {
    vVerdict = await verifyGoalCandidate({
      messages: params.messages,
      objective: goal.objective,
      plan: goal.planText,
      priorGaps: goal.lastClassifierGaps,
      activeModel: params.activeModel,
      effortValue: params.effortValue,
      signal: params.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`[goal] verify failed: ${msg}`, { level: 'error' })
    rollbackClassifierAttempt()
    endVerification()
    pauseGoal(
      'infra',
      `Goal verification infrastructure failed (${msg}). Resume with /goal resume to retry.`,
    )
    return {
      action: 'pause',
      statusMessage: `Goal paused — verification failed: ${msg}\nUse /goal resume to retry.`,
    }
  }

  if (!isGoalActive()) {
    endVerification()
    return { action: 'end_turn' }
  }

  if (!vVerdict.refuted) {
    recordVerificationPassed(vVerdict.evidence)
    completeGoal(vVerdict.evidence)
    return {
      action: 'complete',
      statusMessage: `Goal complete.\n${goal.objective}\n\nEvidence: ${vVerdict.evidence}`,
    }
  }

  // Refuted
  if (vVerdict.blocking === 'user_action' || vVerdict.blocking === 'unverifiable') {
    recordVerificationFailed(
      vVerdict.gapsSummary,
      vVerdict.gapFingerprint,
      vVerdict.evidence,
    )
    pauseGoal(
      'verification',
      `Goal verification found no model-fixable path — paused for your decision.\n${vVerdict.gapsSummary}`,
    )
    return {
      action: 'pause',
      statusMessage: `Goal paused — ${vVerdict.blocking}.\n${vVerdict.gapsSummary}\n\n${vVerdict.evidence}\n\nType /goal resume after addressing it.`,
    }
  }

  const stalled = recordVerificationFailed(
    vVerdict.gapsSummary,
    vVerdict.gapFingerprint,
    vVerdict.evidence,
  )

  const snap = getGoalSnapshot()
  if (snap && snap.classifierRunsAttempted >= snap.classifierMaxRuns) {
    pauseGoal(
      'back_off',
      `Goal classifier rejected completion ${snap.classifierRunsAttempted} times — goal auto-paused.\n${vVerdict.gapsSummary}`,
    )
    return {
      action: 'pause',
      statusMessage: `Goal paused — verification cap reached.\n${vVerdict.gapsSummary}\n\nUse /goal resume to retry.`,
    }
  }

  if (stalled) {
    pauseGoal(
      'no_progress',
      `Goal verification flagged the same gaps with no progress across consecutive attempts — goal auto-paused.\n${vVerdict.gapsSummary}`,
    )
    return {
      action: 'pause',
      statusMessage: `Goal paused — no progress on the same gaps.\n${vVerdict.gapsSummary}\n\nUse /goal resume after adjusting approach.`,
    }
  }

  // Continue with gaps as next step
  return continueWithDirective(
    `Address verifier gaps:\n${vVerdict.gapsSummary}`,
    params.assistantText,
    params.totalTokens,
  )
}

function continueWithDirective(
  nextStep: string,
  assistantText: string | null,
  totalTokens: number,
): GoalRoundDecision {
  const goal = getGoalSnapshot()
  if (!goal || !isGoalActive()) {
    return { action: 'end_turn' }
  }

  const stopPattern = detectPrematureStop(assistantText)
  if (stopPattern) {
    recordPrematureStop(stopPattern)
  }

  accountElapsed()
  updateTokensUsed(totalTokens)

  const directive = renderContinuationDirective({
    goal,
    nextStep,
    bailPreface: stopPattern ? GOAL_BAIL_PREFACE : undefined,
    tokensUsed: goal.tokensUsed,
  })

  return {
    action: 'continue',
    directive,
    statusMessage: `Goal continuing — ${nextStep.slice(0, 200)}`,
  }
}
