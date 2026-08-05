/**
 * /goal slash command — set, status, pause, resume, clear autonomous goals.
 */

import {
  getTotalInputTokens,
  getTotalOutputTokens,
} from '../../bootstrap/state.js'
import {
  clearGoal,
  createGoal,
  formatGoalStatusText,
  generateGoalPlan,
  getGoalSnapshot,
  hasGoal,
  isGoalActive,
  isGoalPausedStatus,
  markPlanningFailed,
  pauseGoal,
  renderGoalResumeUserMessage,
  renderGoalSetUserMessage,
  resumeGoal,
  setPlan,
} from '../../services/goal/index.js'
import type { LocalJSXCommandContext } from '../../types/command.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getMainLoopModel } from '../../utils/model/model.js'

/**
 * Split a trailing `--budget <tokens>` flag off a /goal objective.
 * Only a TRAILING, standalone flag is consumed.
 */
export function parseGoalBudget(trimmed: string): {
  objective: string
  tokenBudget: number | null
} {
  const idx = trimmed.lastIndexOf('--budget')
  if (idx < 0) {
    return { objective: trimmed, tokenBudget: null }
  }
  const head = trimmed.slice(0, idx)
  const tail = trimmed.slice(idx + '--budget'.length)
  const value = tail.trim()
  const flagIsOwnToken =
    (idx === 0 || /\s$/.test(head) || head.length === 0) &&
    /^\s+\S+$/.test(tail) &&
    !/\s/.test(value)
  const headTrimmed = head.trimEnd()
  if (
    flagIsOwnToken &&
    headTrimmed.length > 0 &&
    value.length > 0 &&
    /^\d+$/.test(value)
  ) {
    const budget = Number.parseInt(value, 10)
    if (budget > 0) {
      return { objective: headTrimmed, tokenBudget: budget }
    }
  }
  return { objective: trimmed, tokenBudget: null }
}

function totalTokens(): number {
  return getTotalInputTokens() + getTotalOutputTokens()
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<null> {
  const trimmed = args.trim()
  const lower = trimmed.toLowerCase()

  if (lower === '' || lower === 'status') {
    onDone(formatGoalStatusText())
    return null
  }

  if (lower === 'pause') {
    if (!hasGoal()) {
      onDone('No active goal to pause.')
      return null
    }
    if (!isGoalActive()) {
      onDone(`Goal is not active (status: ${getGoalSnapshot()?.status}).`)
      return null
    }
    pauseGoal('user', 'Paused by user via /goal pause')
    onDone('Goal paused. Use /goal resume to continue.')
    return null
  }

  if (lower === 'clear') {
    if (!hasGoal()) {
      onDone('No goal to clear.')
      return null
    }
    clearGoal()
    onDone('Goal cleared.')
    return null
  }

  if (lower === 'resume') {
    const snap = getGoalSnapshot()
    if (!snap) {
      onDone('No goal to resume. Use `/goal <objective>` to set one.')
      return null
    }
    if (snap.status === 'complete') {
      onDone('Goal is already complete. Use `/goal <objective>` for a new one.')
      return null
    }
    if (snap.status === 'active') {
      onDone('Goal is already active.')
      return null
    }
    if (snap.status === 'budget_limited') {
      onDone(
        'Goal hit its token budget. Set a new goal with a higher `--budget`, or `/goal clear` first.',
      )
      return null
    }
    if (!isGoalPausedStatus(snap.status)) {
      onDone(`Cannot resume goal in status: ${snap.status}`)
      return null
    }
    resumeGoal()
    const userMsg = renderGoalResumeUserMessage(
      snap.objective,
      snap.lastClassifierGaps,
    )
    onDone(`Resuming goal: ${snap.objective}`, {
      shouldQuery: true,
      metaMessages: [userMsg],
    })
    return null
  }

  // Set a new goal (objective text, optional --budget)
  const { objective, tokenBudget } = parseGoalBudget(trimmed)
  if (!objective) {
    onDone(
      'Usage: /goal <objective> [--budget <tokens>] | status | pause | resume | clear',
    )
    return null
  }

  // Replace any existing goal
  if (hasGoal()) {
    clearGoal()
  }

  const effortValue = context.getAppState().effortValue
  const activeModel = getMainLoopModel()
  const baseline = totalTokens()

  const goal = createGoal(objective, {
    tokenBudget,
    tokensBaseline: baseline,
  })

  // Best-effort planning (does not block forever; has internal fallback)
  try {
    const { planText, planPath } = await generateGoalPlan({
      objective,
      activeModel,
      effortValue,
      scratchDir: goal.scratchDir,
      signal: context.abortController.signal,
    })
    setPlan(planText, planPath)
  } catch (err) {
    markPlanningFailed(err instanceof Error ? err.message : String(err))
  }

  const budgetNote =
    tokenBudget !== null
      ? ` (budget ${tokenBudget.toLocaleString()} tokens)`
      : ''
  const userMsg = renderGoalSetUserMessage(objective, tokenBudget)

  onDone(`Goal set${budgetNote}: ${objective}`, {
    shouldQuery: true,
    metaMessages: [userMsg],
  })
  return null
}
