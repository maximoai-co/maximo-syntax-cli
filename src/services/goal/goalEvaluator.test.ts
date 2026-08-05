import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseGoalEvaluatorVerdict,
  resolveEvaluatorModelCandidates,
} from './goalEvaluator.js'
import { parseGoalBudget } from '../../commands/goal/goal.js'
import { detectPrematureStop } from './goalStopDetector.js'
import {
  createGoal,
  clearGoal,
  pauseGoal,
  resumeGoal,
  isGoalActive,
  formatGoalStatusText,
} from './goalTracker.js'
import { parseGoalVerifierVerdict } from './goalVerifier.js'
import { GOAL_EVALUATOR_MODEL } from './types.js'

describe('parseGoalEvaluatorVerdict', () => {
  it('parses all decisions strictly', () => {
    for (const [wire, blocker, expected] of [
      ['continue', '', 'continue'],
      ['candidate_complete', '', 'candidate_complete'],
      ['blocked', 'missing_github_access', 'blocked'],
    ] as const) {
      const raw = JSON.stringify({
        decision: wire,
        evidence: 'observed evidence',
        next_step: 'do one thing',
        blocker_key: blocker,
      })
      const result = parseGoalEvaluatorVerdict(raw)
      assert.equal(result.ok, true)
      if (result.ok) {
        assert.equal(result.verdict.decision, expected)
      }
    }
  })

  it('rejects invalid shapes', () => {
    const bad = [
      '{"decision":"achieved","evidence":"x","next_step":"y","blocker_key":""}',
      '{"decision":"continue","evidence":" ","next_step":"y","blocker_key":""}',
      '{"decision":"blocked","evidence":"x","next_step":"y","blocker_key":""}',
      '{"decision":"blocked","evidence":"x","next_step":"y","blocker_key":"Missing Access"}',
      '{"decision":"continue","evidence":"x","next_step":"y","blocker_key":"missing_access"}',
    ]
    for (const raw of bad) {
      assert.equal(parseGoalEvaluatorVerdict(raw).ok, false, `accepted ${raw}`)
    }
  })

  it('strips markdown fences', () => {
    const raw = '```json\n{"decision":"continue","evidence":"ok","next_step":"go","blocker_key":""}\n```'
    const result = parseGoalEvaluatorVerdict(raw)
    assert.equal(result.ok, true)
  })
})

describe('parseGoalBudget', () => {
  it('parses trailing budget', () => {
    const r = parseGoalBudget('Migrate auth --budget 50000')
    assert.equal(r.objective, 'Migrate auth')
    assert.equal(r.tokenBudget, 50000)
  })

  it('keeps malformed budget in objective', () => {
    const r = parseGoalBudget('do --budget lots')
    assert.equal(r.objective, 'do --budget lots')
    assert.equal(r.tokenBudget, null)
  })

  it('preserves budget mention in middle of text', () => {
    const r = parseGoalBudget('use --budget carefully when costing')
    assert.equal(r.tokenBudget, null)
  })
})

describe('detectPrematureStop', () => {
  it('detects giving up', () => {
    assert.equal(
      detectPrematureStop('Worked on it.\n\nGiving up for now.'),
      'giving_up',
    )
  })

  it('ignores in-prose mentions', () => {
    assert.equal(
      detectPrematureStop('I considered giving up but kept going instead.'),
      null,
    )
  })
})

describe('goalTracker lifecycle', () => {
  it('create pause resume clear', () => {
    clearGoal()
    createGoal('Ship the feature')
    assert.equal(isGoalActive(), true)
    pauseGoal('user')
    assert.equal(isGoalActive(), false)
    resumeGoal()
    assert.equal(isGoalActive(), true)
    assert.match(formatGoalStatusText(), /Ship the feature/)
    clearGoal()
    assert.equal(isGoalActive(), false)
  })
})

describe('parseGoalVerifierVerdict', () => {
  it('parses refuted and not-refuted', () => {
    const pass = parseGoalVerifierVerdict(
      JSON.stringify({
        refuted: false,
        blocking: 'none',
        gaps_summary: '',
        evidence: 'tests pass and criteria hold',
      }),
    )
    assert.equal(pass.refuted, false)

    const fail = parseGoalVerifierVerdict(
      JSON.stringify({
        refuted: true,
        blocking: 'none',
        gaps_summary: 'Missing unit test for parse()',
        evidence: 'no test file exercises parse()',
      }),
    )
    assert.equal(fail.refuted, true)
    assert.ok(fail.gapFingerprint.length > 0)
  })
})

describe('resolveEvaluatorModelCandidates', () => {
  it('always includes a model', () => {
    const c = resolveEvaluatorModelCandidates('some-model')
    assert.ok(c.length >= 1)
    // When not on maximo family, only active model.
    // When on maximo family, nano first then active.
    assert.ok(c.includes('some-model') || c.includes(GOAL_EVALUATOR_MODEL))
    // First candidate is preferred evaluator when maximo family, else active.
    assert.ok(typeof c[0] === 'string' && c[0].length > 0)
  })
})
