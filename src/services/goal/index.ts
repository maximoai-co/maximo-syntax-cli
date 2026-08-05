/**
 * Goal mode public API.
 */

export {
  createGoal,
  clearGoal,
  getGoalSnapshot,
  getGoalStatusSnapshot,
  formatGoalStatusText,
  formatElapsed,
  hasGoal,
  isGoalActive,
  isGoalPausedStatus,
  pauseGoal,
  resumeGoal,
  setPlan,
  markPlanningFailed,
  subscribeGoal,
  updateTokensUsed,
  accountElapsed,
} from './goalTracker.js'

export {
  renderGoalRules,
  renderGoalSetUserMessage,
  renderGoalResumeUserMessage,
  renderContinuationDirective,
} from './goalContinuation.js'

export {
  evaluateGoalRound,
  parseGoalEvaluatorVerdict,
  resolveEvaluatorModelCandidates,
  isMaximoFamilyProvider,
  boundedGoalTranscript,
} from './goalEvaluator.js'

export { verifyGoalCandidate, parseGoalVerifierVerdict } from './goalVerifier.js'
export { generateGoalPlan } from './goalPlanner.js'
export { runGoalRoundEnd } from './goalRound.js'
export { detectPrematureStop } from './goalStopDetector.js'

export {
  GOAL_EVALUATOR_MODEL,
  GOAL_CLASSIFIER_MAX_RUNS_DEFAULT,
  type GoalOrchestration,
  type GoalStatus,
  type GoalPhase,
  type GoalRoundDecision,
  type GoalEvaluatorVerdict,
  type GoalVerifierVerdict,
} from './types.js'
