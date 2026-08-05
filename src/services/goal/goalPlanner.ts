/**
 * Lightweight goal planner — produces a short acceptance checklist via a
 * side model call. Falls back gracefully if planning fails; the implementer
 * can still work from the objective alone.
 */

import { APIUserAbortError } from '@anthropic-ai/sdk'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { logForDebugging } from '../../utils/debug.js'
import { resolveAppliedEffort, type EffortValue } from '../../utils/effort.js'
import {
  createUserMessage,
  getAssistantMessageText,
} from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { queryModelWithoutStreaming } from '../api/maximo.js'
import { resolveEvaluatorModelCandidates } from './goalEvaluator.js'

const PLANNER_PROMPT = `You are the Goal Plan Writer for Maximo Syntax. Convert the OBJECTIVE into a short structured plan the implementer and verifier will use.

Write Markdown with these sections only:
## Goal kind
One of: \`code-change\`, \`analysis\`, \`research\`

## Acceptance criteria
3–7 numbered, outcome-focused criteria (observable results, not file/class names).

## Verification plan
2–5 numbered steps the implementer will run, with expected observations. Include at least one real-path test or launch check when the deliverable is runnable.

## Non-goals
Optional short list of out-of-scope items.

## Task checklist
3–8 concrete implementer steps.

Rules:
- Specify OUTCOMES, not architecture or exact function names.
- Keep it short and unambiguous.
- Do not wrap the whole response in a code fence.
- Do not ask questions; make reasonable assumptions and list them under Non-goals if needed.`

const PLANNER_TIMEOUT_MS = 45_000

export async function generateGoalPlan(params: {
  objective: string
  activeModel: string
  effortValue: EffortValue | undefined
  scratchDir: string | null
  signal?: AbortSignal
}): Promise<{ planText: string; planPath: string | null }> {
  const candidates = resolveEvaluatorModelCandidates(params.activeModel)
  let lastError = 'planner failed'

  for (const model of candidates) {
    const controller = new AbortController()
    const parentSignal = params.signal
    const onAbort = () => controller.abort()
    parentSignal?.addEventListener('abort', onAbort)
    const timeout = setTimeout(() => controller.abort(), PLANNER_TIMEOUT_MS)

    try {
      logForDebugging(`[goal] planner model=${model}`)
      const response = await queryModelWithoutStreaming({
        messages: [
          createUserMessage({
            content: `OBJECTIVE:\n${params.objective}`,
          }),
        ],
        systemPrompt: asSystemPrompt([PLANNER_PROMPT]),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: controller.signal,
        options: {
          getToolPermissionContext: async () => getEmptyToolPermissionContext(),
          model,
          effortValue: resolveAppliedEffort(model, params.effortValue),
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          agents: [],
          querySource: 'goal_planner' as never,
          mcpTools: [],
          skipCacheWrite: true,
        },
      })

      if (response.isApiErrorMessage) {
        throw new Error(
          getAssistantMessageText(response) || 'planner API error',
        )
      }
      let planText = (getAssistantMessageText(response) ?? '').trim()
      if (!planText || planText.length < 40) {
        throw new Error('planner returned empty/short plan')
      }
      // Strip outer fence if model wrapped whole plan
      const fence = planText.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i)
      if (fence?.[1]) planText = fence[1].trim()

      let planPath: string | null = null
      if (params.scratchDir) {
        planPath = join(params.scratchDir, 'plan.md')
        try {
          await writeFile(planPath, planText, 'utf8')
        } catch {
          planPath = null
        }
      }
      return { planText, planPath }
    } catch (err) {
      if (err instanceof APIUserAbortError || controller.signal.aborted) {
        if (parentSignal?.aborted) throw err
        lastError = `planner timed out on ${model}`
      } else {
        lastError = err instanceof Error ? err.message : String(err)
      }
      logForDebugging(`[goal] planner failed on ${model}: ${lastError}`, {
        level: 'error',
      })
    } finally {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', onAbort)
    }
  }

  // Fallback minimal plan so the loop can still run
  const fallback = `## Goal kind
\`code-change\`

## Acceptance criteria
1. The objective is fully implemented as requested: ${params.objective}
2. Targeted tests or verification steps pass for the changed behavior.
3. No placeholders, TODOs, or skipped tests remain in the shipped work.

## Verification plan
1. Inspect changed files for completeness against the objective.
2. Run the most relevant tests or entry-point checks and capture output.
3. Confirm no outstanding TODOs in new/modified code for this goal.

## Task checklist
1. Explore relevant code and clarify scope from the objective.
2. Implement the required changes.
3. Add or update tests; run them and capture results.
4. Fix failures until acceptance criteria hold.

## Non-goals
(Assumed) work beyond the literal objective.`

  logForDebugging(`[goal] using fallback plan (${lastError})`)
  let planPath: string | null = null
  if (params.scratchDir) {
    planPath = join(params.scratchDir, 'plan.md')
    try {
      await writeFile(planPath, fallback, 'utf8')
    } catch {
      planPath = null
    }
  }
  return { planText: fallback, planPath }
}
