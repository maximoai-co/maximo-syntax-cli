/**
 * Heuristic stop-detector for premature "give up" turn endings.
 * Ported from Grok Build's goal_stop_detector patterns.
 */

export type PrematureStopPattern =
  | 'unable_to_proceed'
  | 'giving_up'
  | 'stopping_here'
  | 'agents_in_flight'
  | 'check_back_later'
  | 'verdict_line'
  | 'commit_push_pr'
  | 'ready_for_review'
  | 'please_deflection'

const PATTERNS: Array<{ label: PrematureStopPattern; re: RegExp }> = [
  {
    label: 'unable_to_proceed',
    re: /^I (?:can(?:'?t|not)|am unable to) (?:proceed|continue|make (?:any )?progress|complete|fix this)\b/i,
  },
  {
    label: 'giving_up',
    re: /^(?:Giving up|I(?:'m| am) giving up|The task is not actionable)\b/i,
  },
  {
    label: 'stopping_here',
    re: /^(?:Stopping here|I've stopped here|Parked (?:the|this) branch|Paused here)(?:\.|,|;|$| for | —| -| until| pending| since| because)/i,
  },
  {
    label: 'agents_in_flight',
    re: /^(?:(?:\*\*)?[1-9]\d* (?:agent|cron|task|fork|job|worker|PR|check)s? (?:in flight|remaining|active|still (?:running|working)|pending|running|launched)\b|(?:Continuous )?(?:[Ll]oop|[Cc]rons?|[Bb]abysit) (?:active|healthy|continuing|running|will keep|continues)\b|Waiting for (?:the )?(?:agent|cron|task|fork|worker|job|remaining|them)s?\b|Agents? will report back\b|Waiting\.?$)/i,
  },
  {
    label: 'verdict_line',
    re: /^VERDICT: (?:PASS|FAIL)\b/i,
  },
  {
    label: 'commit_push_pr',
    re: /^(?:Pushed (?:to `|`[0-9a-f]{7,})|Committed as `?[0-9a-f]{7,}\b|Commit: `?[0-9a-f]{7,}\b|(?:Opened|Created) PR #?\d)/i,
  },
  {
    label: 'ready_for_review',
    re: /^Ready (?:for review|to (?:upload|merge|ship|land))\b/i,
  },
  {
    label: 'please_deflection',
    re: /^Please (?:start|run|provide|grant|export|add|install|configure|give me|paste|point me|set (?:the |up |`?[A-Z][A-Z0-9_]+\b))/i,
  },
]

const CHECK_BACK_LATER_BROAD =
  /^(?:I will|I'll|Will) (?:check back|re-?check|poll|look again|retry|re-?run|try again) (?:in\b|again\b|(?:when|once|after|until)\s+(\S+))/i

/**
 * Return the last non-empty paragraph of assistant text.
 */
export function lastNonEmptyParagraph(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return ''
  // Prefer the last line of the last paragraph if multi-line
  const last = paragraphs[paragraphs.length - 1]!
  const lines = last
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  return lines[lines.length - 1] ?? last
}

function checkBackLaterMatches(line: string): boolean {
  const m = line.match(CHECK_BACK_LATER_BROAD)
  if (!m) return false
  const target = (m[1] ?? '').toLowerCase()
  // If deferral target is "you/your", it's a user handoff — not premature stop
  if (target.startsWith('you') || target.startsWith('your')) return false
  return true
}

/**
 * Detect premature stop phrasing in the agent's final response.
 * Returns the matched pattern label, or null if none.
 */
export function detectPrematureStop(
  assistantText: string | null | undefined,
): PrematureStopPattern | null {
  if (!assistantText) return null
  const line = lastNonEmptyParagraph(assistantText)
  if (!line) return null

  for (const { label, re } of PATTERNS) {
    if (re.test(line)) return label
  }
  if (checkBackLaterMatches(line)) return 'check_back_later'
  return null
}
