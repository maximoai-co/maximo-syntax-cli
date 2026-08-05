/**
 * Adversarial goal verifier — single skeptic pass (tool-free JSON).
 * Conservative: default to refuted when uncertain.
 */

import { APIUserAbortError } from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { resolveAppliedEffort, type EffortValue } from '../../utils/effort.js'
import {
  createUserMessage,
  getAssistantMessageText,
} from '../../utils/messages.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { queryModelWithoutStreaming } from '../api/maximo.js'
import { boundedGoalTranscript } from './goalEvaluator.js'
import {
  GOAL_VERIFIER_TIMEOUT_MS,
  type GoalVerifierVerdict,
} from './types.js'

const SYSTEM_PROMPT = `You are an adversarial verifier for an autonomous coding goal harness.
You are NOT the agent that produced the work. Your job is to REFUTE that the
objective has been met. Default to refuted: true if uncertain — a false-positive
(passing broken work) ends the loop wrongly and is far worse than one more iteration.

Return exactly one JSON object:
{
  "refuted": boolean,
  "blocking": "none" | "user_action" | "unverifiable",
  "gaps_summary": string,   // concrete, actionable gaps the implementer must fix; empty if not refuted
  "evidence": string        // concrete evidence for your decision
}

Rules:
1. OBJECTIVE and any artifacts it explicitly names are the immutable contract.
2. A confident final response is NOT evidence. Prefer tests, file diffs, and captured output.
3. TODO/FIXME/unimplemented!/todo!(), skipped tests, or ignore marks on tests this goal added — refute.
4. Missing tests alone are NOT grounds to refute once criteria hold by auditing evidence.
5. Do NOT invent requirements beyond the objective. When every criterion is met, set refuted:false.
6. blocking:
   - "none" for ordinary model-fixable gaps
   - "user_action" when the user must provide credentials/access/external setup
   - "unverifiable" when there is no honest evidence path at all
7. On re-verification (PRIOR_GAPS non-empty), primarily check those gaps are fixed; do not raise the bar with new nits.

Respond with ONLY the JSON object — no markdown fences.`

function fingerprintGaps(gaps: string): string {
  const normalized = gaps
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

export function parseGoalVerifierVerdict(
  raw: string,
): GoalVerifierVerdict {
  let cleaned = raw.trim()
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  if (fence?.[1]) cleaned = fence[1].trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } else {
      throw new Error('verifier output is not valid JSON')
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('verifier output is not an object')
  }
  const obj = parsed as Record<string, unknown>
  const refuted = Boolean(obj.refuted)
  const blockingRaw = String(obj.blocking ?? 'none').toLowerCase()
  const blocking =
    blockingRaw === 'user_action' || blockingRaw === 'unverifiable'
      ? blockingRaw
      : 'none'
  const gapsSummary = String(
    obj.gaps_summary ?? obj.gapsSummary ?? '',
  ).trim()
  const evidence = String(obj.evidence ?? '').trim()
  if (!evidence) {
    throw new Error('verifier evidence is empty')
  }
  if (refuted && !gapsSummary) {
    throw new Error('refuted verdict requires gaps_summary')
  }

  return {
    refuted,
    blocking,
    gapsSummary: refuted ? gapsSummary : '',
    evidence,
    gapFingerprint: refuted ? fingerprintGaps(gapsSummary) : '',
  }
}

export async function verifyGoalCandidate(params: {
  messages: readonly Message[]
  objective: string
  plan: string | null
  priorGaps: string | null
  activeModel: string
  effortValue: EffortValue | undefined
  signal?: AbortSignal
}): Promise<GoalVerifierVerdict> {
  const transcript = boundedGoalTranscript(params.messages)
  // Verifier uses the active (stronger) model — not the cheap evaluator nano.
  const model = params.activeModel.trim() || getMainLoopModel()

  const payload = JSON.stringify({
    OBJECTIVE: params.objective,
    PLAN: params.plan ?? '(unavailable)',
    PRIOR_GAPS: params.priorGaps ?? '(none)',
    TRANSCRIPT: transcript,
  })

  const controller = new AbortController()
  const parentSignal = params.signal
  const onAbort = () => controller.abort()
  parentSignal?.addEventListener('abort', onAbort)
  const timeout = setTimeout(
    () => controller.abort(),
    GOAL_VERIFIER_TIMEOUT_MS,
  )

  try {
    logForDebugging(`[goal] verifier model=${model}`)
    const response = await queryModelWithoutStreaming({
      messages: [createUserMessage({ content: payload })],
      systemPrompt: asSystemPrompt([SYSTEM_PROMPT]),
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
        querySource: 'goal_verifier' as never,
        mcpTools: [],
        skipCacheWrite: true,
      },
    })

    if (response.isApiErrorMessage) {
      throw new Error(
        getAssistantMessageText(response) || 'goal verifier API error',
      )
    }
    const raw = getAssistantMessageText(response) ?? ''
    return parseGoalVerifierVerdict(raw)
  } catch (err) {
    if (err instanceof APIUserAbortError || controller.signal.aborted) {
      if (parentSignal?.aborted) throw err
      throw new Error('goal verifier timed out or aborted')
    }
    throw err
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', onAbort)
  }
}
