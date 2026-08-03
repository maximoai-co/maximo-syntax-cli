import type { Command } from '../../commands.js'

const skills = {
  type: 'local-jsx',
  name: 'skills',
  description: 'Browse, invoke, reload, link, and manage local skills',
  argumentHint: '[list|reload|create|use|info|enable|disable|disabled|link]',
  load: () => import('./skills.js'),
} satisfies Command

export default skills
