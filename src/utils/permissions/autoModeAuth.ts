/**
 * Auth gates for classifier auto mode.
 *
 * Auto mode (transcript classifier) is only offered when the user is logged
 * in via Maximo AI or MyTabulon, because the classifier side-query reuses the
 * same connected login / API path as the main agent. Other providers
 * (Ollama, Gemini bare keys, Bedrock, etc.) keep default/bypass modes only.
 */

import { isMaximoAIOpenAICompatibleProvider, isMaximoAISubscriber } from '../auth.js'
import { isMyTabulonProvider } from '../../services/api/maximoModels.js'

/**
 * True when the current login can run the auto-mode classifier side-query
 * with the session's credentials (Maximo AI or MyTabulon).
 */
export function supportsClassifierAutoModeAuth(): boolean {
  try {
    if (isMaximoAISubscriber()) return true
    if (isMaximoAIOpenAICompatibleProvider()) return true
    if (isMyTabulonProvider()) return true
    return false
  } catch {
    // Config may be unavailable during early bootstrap / tests
    return false
  }
}

export function getClassifierAutoModeAuthUnavailableMessage(): string {
  return (
    'Auto mode (with classifier) requires a Maximo AI or MyTabulon login. ' +
    'Run /login, or use --always-approve / --yolo for full no-prompt mode ' +
    '(no classifier; recommended only in a sandbox).'
  )
}
