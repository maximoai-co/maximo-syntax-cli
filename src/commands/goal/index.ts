import type { Command } from '../../commands.js'

const goal = {
  type: 'local-jsx',
  name: 'goal',
  description:
    'Set, manage, or check an autonomous goal (works across turns with independent completion verification)',
  argumentHint: '<objective> [--budget <tokens>] | status | pause | resume | clear',
  load: () => import('./goal.js'),
} satisfies Command

export default goal
