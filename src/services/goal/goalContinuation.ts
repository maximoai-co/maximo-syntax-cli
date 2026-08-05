/**
 * Goal continuation directives and rules templates.
 */

import { formatElapsed } from './goalTracker.js'
import type { GoalOrchestration } from './types.js'

export function renderGoalRules(objective: string, plan: string | null, scratchDir: string | null): string {
  const planBlock = plan
    ? `\nPLAN (source of truth for acceptance):\n${plan}\n`
    : '\nNo frozen plan yet — create a short acceptance checklist in your first TodoWrite, then implement.\n'
  const scratch = scratchDir
    ? `Use scratch dir ${scratchDir} only for captured test output and throwaway artifacts.`
    : 'Use a private temp directory for captured test output; avoid shared /tmp paths.'

  return `A goal has been set: ${objective}

You are working directly on this goal across multiple turns. Deliver
EVERYTHING the user asked for yourself — no follow-up questions, no manual
steps left for the user.
${planBlock}
TRACKING: use TodoWrite to break the objective into concrete steps; keep ≥1
in_progress with a present-tense activeForm, and mark each done immediately
(do not batch).

WORKING: implement it yourself and test it on the real user path. Where a
behavior cannot be driven end-to-end here, cover it with a static / structural
check (assert the artifact exists in the source) plus a unit test of the real
shipped function — not a flaky end-to-end run.

NO TEST THEATER: a passing test must prove the SHIPPED code works on the real
path. Never hard-code the expected value, start past the thing under test,
re-implement the code under test inside the test, or report success without
driving the real entry point. A test that passes while the program is broken is
worse than none.

VERIFY AS YOU GO: run each change. If output is visual, capture and inspect it;
for data/config, validate programmatically.

SCRATCH: ${scratch} Never set HOME, package-manager homes, virtualenvs, caches,
or config dirs to scratch. The verifier AUDITS your committed tests and saved
evidence instead of rebuilding them, so honest, durable proof is what passes.

TEST PROACTIVELY: run targeted tests after every change, not just at the end.
The harness evaluates completion automatically after every model round. When the
work appears complete it runs the adversarial verification panel itself and
continues with any concrete gaps. Do not stop merely to announce completion.
If a real external blocker remains after repeated attempts, explain the exact
evidence and user action needed in your final response; the harness applies the
repeated-blocker policy automatically.`
}

export function renderContinuationDirective(params: {
  goal: GoalOrchestration
  nextStep: string
  bailPreface?: string
  tokensUsed: number
}): string {
  const g = params.goal
  const planPointer = g.planText
    ? `Plan summary:\n${g.planText.slice(0, 2000)}\n\n`
    : ''
  const verifierGaps = g.lastClassifierGaps
    ? `Outstanding verifier gaps (must address):\n${g.lastClassifierGaps}\n\n`
    : ''
  const bail = params.bailPreface
    ? `${params.bailPreface}\n\n`
    : ''
  const scratch = g.scratchDir ?? '(none)'

  return `<system-reminder>
<goal-state>
Objective: ${g.objective}
Status: Active
Tokens: ${params.tokensUsed} | Elapsed: ${formatElapsed(g.elapsedMs)}
</goal-state>

${bail}${planPointer}${verifierGaps}Goal NOT complete — continue working. Next step:
${params.nextStep}

Keep your TodoWrite list current (≥1 in_progress, descriptive activeForm).
Run targeted tests after every change you make, not just at the end. Tests must
drive the SHIPPED code on the real path — no hard-coded values, no starting past
the thing under test, no re-implementing it. Use your scratch dir ${scratch}
only for captured test output, temp scripts, and throwaway artifacts.
The harness evaluates completion automatically after this round and re-checks
adversarially when appropriate.
</system-reminder>`
}

export const GOAL_BAIL_PREFACE =
  'You appeared to stop early while goal work remains open. Do not hand off or park the task — keep implementing.'

export function renderGoalSetUserMessage(objective: string, budget: number | null): string {
  const budgetLine =
    budget !== null
      ? `Token budget for this goal: ${budget.toLocaleString()}.`
      : 'No token budget set for this goal.'
  return `Begin autonomous goal mode.

Objective: ${objective}
${budgetLine}

Write a short plan with TodoWrite (acceptance criteria + verification steps), then implement and verify until the objective is fully met. Do not stop to ask whether you should continue — the harness decides completion.`
}

export function renderGoalResumeUserMessage(objective: string, gaps: string | null): string {
  const gapBlock = gaps
    ? `\nOutstanding gaps from the last verification:\n${gaps}\n`
    : ''
  return `Resume autonomous goal mode for: ${objective}
${gapBlock}
Continue from where you left off. Address any outstanding gaps, keep TodoWrite current, and do not stop until the objective is fully met.`
}
