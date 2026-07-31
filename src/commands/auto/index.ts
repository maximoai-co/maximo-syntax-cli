import type { Command } from '../../commands.js'

/**
 * /auto — pick classifier auto, always-approve (no classifier), or off.
 * Always registered so the picker UX is available even if only YOLO works.
 */
const auto = {
  type: 'local-jsx' as const,
  name: 'auto',
  aliases: ['always-approve', 'yolo', 'bypass-permissions'],
  description:
    'Choose auto mode: classifier (safer, extra usage) or always-approve (no classifier)',
  argumentHint: '[classifier|always-approve|off]',
  load: () => import('./auto.js'),
} satisfies Command

export default auto
