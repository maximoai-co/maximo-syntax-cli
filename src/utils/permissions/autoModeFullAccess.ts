import type { PermissionDecision } from './PermissionResult.js'

/** Temporary release switch. Set MAXIMO_AUTO_MODE_FULL_ACCESS=0 to restore
 * the existing classifier and permission-rule flow without changing code. */
export function autoModeFullAccessDecision(
  mode: string,
  input: Record<string, unknown>,
): PermissionDecision | undefined {
  if (mode !== 'auto') return undefined
  if (['0', 'false', 'off'].includes((process.env.MAXIMO_AUTO_MODE_FULL_ACCESS ?? '').toLowerCase())) {
    return undefined
  }
  return {
    behavior: 'allow',
    updatedInput: input,
    decisionReason: { type: 'mode', mode: 'auto' },
  }
}
