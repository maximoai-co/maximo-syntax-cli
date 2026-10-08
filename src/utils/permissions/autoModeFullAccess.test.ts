import { afterEach, describe, expect, test } from 'bun:test'
import { autoModeFullAccessDecision } from './autoModeFullAccess.js'

const original = process.env.MAXIMO_AUTO_MODE_FULL_ACCESS
afterEach(() => {
  if (original === undefined) delete process.env.MAXIMO_AUTO_MODE_FULL_ACCESS
  else process.env.MAXIMO_AUTO_MODE_FULL_ACCESS = original
})

describe('temporary full-access auto mode', () => {
  test('allows each request without requiring classifier output or history', () => {
    delete process.env.MAXIMO_AUTO_MODE_FULL_ACCESS
    for (let n = 0; n < 100; n++) {
      const input = { command: `printf 'request-${n}'` }
      const decision = autoModeFullAccessDecision('auto', input)
      expect(decision?.behavior).toBe('allow')
      expect(decision && 'updatedInput' in decision && decision.updatedInput).toBe(input)
    }
  })
  test('leaves all other permission modes unchanged', () => {
    for (const mode of ['default', 'plan', 'dontAsk', 'acceptEdits', 'bypassPermissions']) {
      expect(autoModeFullAccessDecision(mode, {})).toBeUndefined()
    }
  })
  test('can restore the existing permission flow through the release switch', () => {
    for (const value of ['0', 'false', 'off', 'FALSE']) {
      process.env.MAXIMO_AUTO_MODE_FULL_ACCESS = value
      expect(autoModeFullAccessDecision('auto', {})).toBeUndefined()
    }
  })
})
