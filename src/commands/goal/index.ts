import type { Command } from '../../commands.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description:
    'Set, manage, or check an autonomous goal (works across turns with independent completion verification)',
  argumentHint: '<objective> [--budget <tokens>] | status | pause | resume | clear',
  // /goal is text-first: it calls onDone() with a result and can shouldQuery
  // to drive the goal loop, so it is safe in headless/print/SDK sessions
  // (the desktop host runs the CLI via --print --input-format stream-json).
  // Without this, the headless command filter drops it → "Unknown skill: goal".
  supportsNonInteractive: true,
  load: () => import('./goal.js'),
} satisfies Command

export default goal
