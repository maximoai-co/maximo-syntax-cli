import { feature } from 'bun:bundle'
import z from 'zod/v4'
import { PAUSE_ICON } from '../../constants/figures.js'
// Types extracted to src/types/permissions.ts to break import cycles
import {
  EXTERNAL_PERMISSION_MODES,
  type ExternalPermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from '../../types/permissions.js'
import { lazySchema } from '../lazySchema.js'

// Re-export for backwards compatibility
export {
  EXTERNAL_PERMISSION_MODES,
  PERMISSION_MODES,
  type ExternalPermissionMode,
  type PermissionMode,
}

export const permissionModeSchema = lazySchema(() => z.enum(PERMISSION_MODES))
export const externalPermissionModeSchema = lazySchema(() =>
  z.enum(EXTERNAL_PERMISSION_MODES),
)

type ModeColorKey =
  | 'text'
  | 'planMode'
  | 'permission'
  | 'autoAccept'
  | 'error'
  | 'warning'

type PermissionModeConfig = {
  title: string
  shortTitle: string
  /** Compact footer line under the prompt (distinct for classifier vs YOLO). */
  footerLabel: string
  /** One-line toast when the mode becomes active. */
  activateMessage: string
  symbol: string
  color: ModeColorKey
  external: ExternalPermissionMode
}

/** Distinct glyph for classifier auto (not the same as accept-edits / bypass). */
const AUTO_CLASSIFIER_SYMBOL = '◎'
/** Warning glyph for full always-approve / no-classifier mode. */
const ALWAYS_APPROVE_SYMBOL = '⚠'

const PERMISSION_MODE_CONFIG: Partial<
  Record<PermissionMode, PermissionModeConfig>
> = {
  default: {
    title: 'Default',
    shortTitle: 'Default',
    footerLabel: 'default',
    activateMessage: 'Default mode · permission prompts restored',
    symbol: '',
    color: 'text',
    external: 'default',
  },
  plan: {
    title: 'Plan Mode',
    shortTitle: 'Plan',
    footerLabel: 'plan mode',
    activateMessage: 'Plan mode on · read-only until you approve a plan',
    symbol: PAUSE_ICON,
    color: 'planMode',
    external: 'plan',
  },
  acceptEdits: {
    title: 'Accept edits',
    shortTitle: 'Accept',
    footerLabel: 'accept edits',
    activateMessage: 'Accept edits on · file edits auto-approved in project',
    symbol: '⏵⏵',
    color: 'autoAccept',
    external: 'acceptEdits',
  },
  bypassPermissions: {
    title: 'Always-approve',
    shortTitle: 'YOLO',
    footerLabel: 'always-approve · no classifier',
    activateMessage:
      'Always-approve ON · no permission prompts, no safety classifier (sandbox recommended)',
    symbol: ALWAYS_APPROVE_SYMBOL,
    color: 'error',
    external: 'bypassPermissions',
  },
  dontAsk: {
    title: "Don't Ask",
    shortTitle: 'DontAsk',
    footerLabel: "don't ask",
    activateMessage: "Don't-ask mode on · only pre-approved tools run",
    symbol: '⏵⏵',
    color: 'error',
    external: 'dontAsk',
  },
  ...(feature('TRANSCRIPT_CLASSIFIER')
    ? {
        auto: {
          title: 'Auto · classifier',
          shortTitle: 'Auto+',
          footerLabel: 'auto · classifier',
          activateMessage:
            'Auto (classifier) ON · safe tools run; risky tools classified (uses extra usage)',
          symbol: AUTO_CLASSIFIER_SYMBOL,
          color: 'warning' as ModeColorKey,
          external: 'default' as ExternalPermissionMode,
        },
      }
    : {}),
}

/**
 * Type guard to check if a PermissionMode is an ExternalPermissionMode.
 * auto is ant-only and excluded from external modes.
 */
export function isExternalPermissionMode(
  mode: PermissionMode,
): mode is ExternalPermissionMode {
  // External users can't have auto, so always true for them
  if (process.env.USER_TYPE !== 'ant') {
    return true
  }
  return mode !== 'auto' && mode !== 'bubble'
}

function getModeConfig(mode: PermissionMode): PermissionModeConfig {
  return PERMISSION_MODE_CONFIG[mode] ?? PERMISSION_MODE_CONFIG.default!
}

export function toExternalPermissionMode(
  mode: PermissionMode,
): ExternalPermissionMode {
  return getModeConfig(mode).external
}

export function permissionModeFromString(str: string): PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(str)
    ? (str as PermissionMode)
    : 'default'
}

export function permissionModeTitle(mode: PermissionMode): string {
  return getModeConfig(mode).title
}

export function isDefaultMode(mode: PermissionMode | undefined): boolean {
  return mode === 'default' || mode === undefined
}

export function permissionModeShortTitle(mode: PermissionMode): string {
  return getModeConfig(mode).shortTitle
}

export function permissionModeSymbol(mode: PermissionMode): string {
  return getModeConfig(mode).symbol
}

export function getModeColor(mode: PermissionMode): ModeColorKey {
  return getModeConfig(mode).color
}

/**
 * Footer status line label (shown while mode is active under the prompt).
 * Distinguishes classifier auto from always-approve (no classifier).
 */
export function permissionModeFooterLabel(mode: PermissionMode): string {
  return getModeConfig(mode).footerLabel
}

/**
 * Toast / notification text when switching into this mode (Shift+Tab, /auto, etc.).
 */
export function permissionModeActivateMessage(mode: PermissionMode): string {
  return getModeConfig(mode).activateMessage
}

/** True for modes that skip ordinary user prompts (classifier or full bypass). */
export function isAutonomousPermissionMode(mode: PermissionMode): boolean {
  return mode === 'auto' || mode === 'bypassPermissions'
}
