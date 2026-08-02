import { feature } from 'bun:bundle'
import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { AutoModeOptInDialog } from '../../components/AutoModeOptInDialog.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import type { PermissionMode } from '../../types/permissions.js'
import {
  getClassifierAutoModeAuthUnavailableMessage,
  supportsClassifierAutoModeAuth,
} from '../../utils/permissions/autoModeAuth.js'
import {
  PERMISSION_MODES,
  permissionModeActivateMessage,
  permissionModeFooterLabel,
  permissionModeSymbol,
  permissionModeTitle,
} from '../../utils/permissions/PermissionMode.js'
import { applyPermissionUpdate } from '../../utils/permissions/PermissionUpdate.js'
import {
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isAutoModeGateEnabled,
  transitionPermissionMode,
} from '../../utils/permissions/permissionSetup.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
  hasAutoModeOptIn,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

const USAGE_WARNING =
  'Uses your active model as a safety classifier — extra API calls bill against the same Maximo AI / MyTabulon usage pool.'

const YOLO_WARNING =
  'No safety classifier. Tools run without permission prompts. Use only in a sandbox/VM. Deny rules and hooks still apply.'

type AutoChoice = 'classifier' | 'always-approve' | 'off' | 'cancel'

function setPermissionMode(
  context: LocalJSXCommandContext,
  fromMode: string,
  toMode: PermissionMode,
  persist: boolean = true,
): void {
  context.setAppState(prev => {
    const base =
      toMode === 'bypassPermissions'
        ? {
            ...prev.toolPermissionContext,
            isBypassPermissionsModeAvailable: true,
          }
        : prev.toolPermissionContext
    const nextCtx = transitionPermissionMode(fromMode, toMode, base)
    return {
      ...prev,
      toolPermissionContext: applyPermissionUpdate(nextCtx, {
        type: 'setMode',
        mode: toMode,
        destination: 'session',
      }),
    }
  })
  // Persist the mode so it survives restarts, matching /model and /effort.
  // initialPermissionModeFromCLI restores settings.permissions.defaultMode at
  // startup, so /auto (classifier), /auto always-approve, and /auto off all
  // stay sticky across sessions. The always-approve confirm dialog's
  // "for this session" option passes persist: false to keep that choice
  // session-only. Switching back to 'default' clears the persisted key so a
  // previous auto/always-approve choice doesn't stick. 'bubble' is
  // internal-only and never passed here; cast to the defaultMode enum
  // (PERMISSION_MODES includes 'auto').
  if (persist) {
    updateSettingsForSource('userSettings', {
      permissions: {
        defaultMode:
          toMode === 'default'
            ? undefined
            : (toMode as (typeof PERMISSION_MODES)[number]),
      },
    })
  }
}

function bypassDisabledBySettings(): boolean {
  const settings = getSettings_DEPRECATED() || {}
  return settings.permissions?.disableBypassPermissionsMode === 'disable'
}

function hasBypassOptIn(): boolean {
  return Boolean(
    getSettingsForSource('userSettings')?.skipDangerousModePermissionPrompt ||
      getSettingsForSource('localSettings')?.skipDangerousModePermissionPrompt,
  )
}

function currentLabel(mode: PermissionMode): string {
  const sym = permissionModeSymbol(mode)
  return `${sym ? sym + ' ' : ''}${permissionModeTitle(mode)} · footer: “${permissionModeFooterLabel(mode)}${mode === 'default' ? '' : ' on'}”`
}

function doneEnabled(
  onDone: LocalJSXCommandOnDone,
  mode: PermissionMode,
  extra?: string,
): void {
  const msg = permissionModeActivateMessage(mode)
  onDone(extra ? `${msg}\n${extra}` : msg)
}

type PickerProps = {
  currentMode: PermissionMode
  classifierAvailable: boolean
  classifierUnavailableReason: string | null
  onPick: (choice: AutoChoice) => void
  onCancel: () => void
}

function AutoModePicker(props: PickerProps): React.ReactNode {
  const {
    currentMode,
    classifierAvailable,
    classifierUnavailableReason,
    onPick,
    onCancel,
  } = props

  const options: { label: string; value: AutoChoice }[] = [
    {
      label: classifierAvailable
        ? `◎ Auto · classifier${currentMode === 'auto' ? '  (active)' : ''} — extra usage for safety checks`
        : `◎ Auto · classifier  (unavailable${classifierUnavailableReason ? `: ${classifierUnavailableReason}` : ''})`,
      value: 'classifier',
    },
    {
      label: `⚠ Always-approve · no classifier${currentMode === 'bypassPermissions' ? '  (active)' : ''} — full no-prompt (sandbox recommended)`,
      value: 'always-approve',
    },
  ]

  if (currentMode === 'auto' || currentMode === 'bypassPermissions') {
    options.push({
      label: '○ Off — restore default permission prompts',
      value: 'off',
    })
  }

  options.push({
    label: 'Cancel',
    value: 'cancel',
  })

  return (
    <Dialog title="Auto modes" color="warning" onCancel={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text>
          Pick how Maximo handles permission prompts. Active:{' '}
          <Text bold color={currentMode === 'bypassPermissions' ? 'error' : currentMode === 'auto' ? 'warning' : undefined}>
            {currentLabel(currentMode)}
          </Text>
        </Text>
        <Text dimColor>
          Classifier auto is safer but uses extra usage. Always-approve skips
          all prompts with no classifier.
        </Text>
        <Select
          options={options}
          onChange={value => onPick(value as AutoChoice)}
          onCancel={onCancel}
        />
      </Box>
    </Dialog>
  )
}

type ConfirmYoloProps = {
  onAccept: (remember: boolean) => void
  onDecline: () => void
}

function ConfirmAlwaysApprove(props: ConfirmYoloProps): React.ReactNode {
  return (
    <Dialog
      title="WARNING: Always-approve (no classifier)?"
      color="error"
      onCancel={props.onDecline}
    >
      <Box flexDirection="column" gap={1}>
        <Text>{YOLO_WARNING}</Text>
        <Select
          options={[
            {
              label: 'Yes, enable always-approve for this session',
              value: 'accept',
            },
            {
              label: 'Yes, and remember my choice',
              value: 'accept-remember',
            },
            { label: 'No, go back', value: 'decline' },
          ]}
          onChange={value => {
            if (value === 'decline') {
              props.onDecline()
              return
            }
            props.onAccept(value === 'accept-remember')
          }}
          onCancel={props.onDecline}
        />
      </Box>
    </Dialog>
  )
}

/**
 * /auto — single picker for classifier auto vs always-approve vs off.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  if (feature('TRANSCRIPT_CLASSIFIER') ? false : true) {
    // Build without classifier: still allow always-approve / off via picker
  }

  const arg = args.trim().toLowerCase()
  const appState = context.getAppState()
  const currentMode = appState.toolPermissionContext.mode as PermissionMode

  const classifierOk =
    (feature('TRANSCRIPT_CLASSIFIER') ? true : false) &&
    supportsClassifierAutoModeAuth() &&
    isAutoModeGateEnabled()

  let classifierUnavailableReason: string | null = null
  if (feature('TRANSCRIPT_CLASSIFIER') ? true : false) {
    if (!supportsClassifierAutoModeAuth()) {
      classifierUnavailableReason = 'Maximo AI or MyTabulon login required'
    } else if (!isAutoModeGateEnabled()) {
      const reason = getAutoModeUnavailableReason()
      classifierUnavailableReason = reason
        ? getAutoModeUnavailableNotification(reason)
        : 'unavailable'
    }
  } else {
    classifierUnavailableReason = 'not in this build'
  }

  // CLI-style shortcuts still work: /auto off | classifier | always-approve | yolo
  if (
    arg === 'off' ||
    arg === 'disable' ||
    arg === 'false' ||
    arg === '0' ||
    arg === 'default'
  ) {
    if (currentMode === 'default') {
      onDone('Already on default permission prompts.')
      return null
    }
    setPermissionMode(context, currentMode, 'default')
    doneEnabled(onDone, 'default')
    return null
  }
  if (
    arg === 'classifier' ||
    arg === 'auto' ||
    arg === 'safe' ||
    arg === 'with-classifier'
  ) {
    return applyClassifier(onDone, context, currentMode, classifierOk)
  }
  if (
    arg === 'always-approve' ||
    arg === 'yolo' ||
    arg === 'bypass' ||
    arg === 'unsafe' ||
    arg === 'no-classifier'
  ) {
    return applyAlwaysApprove(onDone, context, currentMode)
  }

  // Interactive picker (default UX)
  return (
    <AutoModePickerFlow
      context={context}
      currentMode={currentMode}
      classifierAvailable={classifierOk}
      classifierUnavailableReason={classifierUnavailableReason}
      onDone={onDone}
    />
  )
}

function AutoModePickerFlow(props: {
  context: LocalJSXCommandContext
  currentMode: PermissionMode
  classifierAvailable: boolean
  classifierUnavailableReason: string | null
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const {
    context,
    currentMode,
    classifierAvailable,
    classifierUnavailableReason,
    onDone,
  } = props
  const [step, setStep] = React.useState<
    'pick' | 'classifier-consent' | 'yolo-consent'
  >('pick')

  if (step === 'classifier-consent') {
    return (
      <AutoModeOptInDialog
        onAccept={() => {
          // AutoModeOptInDialog persists defaultMode itself for the
          // "make it my default mode" option; plain "enable auto mode" is
          // session-only, so don't double-persist here.
          setPermissionMode(context, currentMode, 'auto', false)
          doneEnabled(onDone, 'auto', USAGE_WARNING)
        }}
        onDecline={() => onDone('Auto mode not enabled.')}
      />
    )
  }

  if (step === 'yolo-consent') {
    return (
      <ConfirmAlwaysApprove
        onAccept={remember => {
          if (remember) {
            updateSettingsForSource('userSettings', {
              skipDangerousModePermissionPrompt: true,
            })
          }
          setPermissionMode(
            context,
            currentMode,
            'bypassPermissions',
            remember,
          )
          doneEnabled(onDone, 'bypassPermissions', YOLO_WARNING)
        }}
        onDecline={() => onDone('Always-approve not enabled.')}
      />
    )
  }

  return (
    <AutoModePicker
      currentMode={currentMode}
      classifierAvailable={classifierAvailable}
      classifierUnavailableReason={classifierUnavailableReason}
      onCancel={() => onDone()}
      onPick={choice => {
        switch (choice) {
          case 'cancel':
            onDone()
            return
          case 'off':
            if (currentMode === 'default') {
              onDone('Already on default permission prompts.')
              return
            }
            setPermissionMode(context, currentMode, 'default')
            doneEnabled(onDone, 'default')
            return
          case 'classifier':
            if (!classifierAvailable) {
              onDone(
                classifierUnavailableReason
                  ? `Cannot enable classifier auto: ${classifierUnavailableReason}`
                  : getClassifierAutoModeAuthUnavailableMessage(),
              )
              return
            }
            if (!hasAutoModeOptIn()) {
              setStep('classifier-consent')
              return
            }
            setPermissionMode(context, currentMode, 'auto')
            doneEnabled(onDone, 'auto', USAGE_WARNING)
            return
          case 'always-approve':
            if (bypassDisabledBySettings()) {
              onDone(
                'Always-approve is disabled by settings (permissions.disableBypassPermissionsMode).',
              )
              return
            }
            if (!hasBypassOptIn()) {
              setStep('yolo-consent')
              return
            }
            setPermissionMode(context, currentMode, 'bypassPermissions')
            doneEnabled(onDone, 'bypassPermissions', YOLO_WARNING)
            return
        }
      }}
    />
  )
}

async function applyClassifier(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  currentMode: PermissionMode,
  classifierOk: boolean,
): Promise<React.ReactNode> {
  if (!classifierOk) {
    if (!supportsClassifierAutoModeAuth()) {
      onDone(getClassifierAutoModeAuthUnavailableMessage())
      return null
    }
    const reason = getAutoModeUnavailableReason()
    onDone(
      reason
        ? `Cannot enable classifier auto: ${getAutoModeUnavailableNotification(reason)}`
        : 'Cannot enable classifier auto right now.',
    )
    return null
  }
  if (currentMode === 'auto') {
    onDone(
      `◎ Auto · classifier is already ON.\n${USAGE_WARNING}`,
    )
    return null
  }
  if (!hasAutoModeOptIn()) {
    return (
      <AutoModeOptInDialog
        onAccept={() => {
          // AutoModeOptInDialog persists defaultMode itself for the
          // "make it my default mode" option; plain "enable auto mode" is
          // session-only, so don't double-persist here.
          setPermissionMode(context, currentMode, 'auto', false)
          doneEnabled(onDone, 'auto', USAGE_WARNING)
        }}
        onDecline={() => onDone('Auto mode not enabled.')}
      />
    )
  }
  setPermissionMode(context, currentMode, 'auto')
  doneEnabled(onDone, 'auto', USAGE_WARNING)
  return null
}

async function applyAlwaysApprove(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  currentMode: PermissionMode,
): Promise<React.ReactNode> {
  if (bypassDisabledBySettings()) {
    onDone(
      'Always-approve is disabled by settings (permissions.disableBypassPermissionsMode).',
    )
    return null
  }
  if (currentMode === 'bypassPermissions') {
    onDone(`⚠ Always-approve is already ON.\n${YOLO_WARNING}`)
    return null
  }
  if (!hasBypassOptIn()) {
    return (
      <ConfirmAlwaysApprove
        onAccept={remember => {
          if (remember) {
            updateSettingsForSource('userSettings', {
              skipDangerousModePermissionPrompt: true,
            })
          }
          setPermissionMode(
            context,
            currentMode,
            'bypassPermissions',
            remember,
          )
          doneEnabled(onDone, 'bypassPermissions', YOLO_WARNING)
        }}
        onDecline={() => onDone('Always-approve not enabled.')}
      />
    )
  }
  setPermissionMode(context, currentMode, 'bypassPermissions')
  doneEnabled(onDone, 'bypassPermissions', YOLO_WARNING)
  return null
}
