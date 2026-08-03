import { KEYBINDING_ACTIONS } from './schema.js'

export type ActionCategory =
  | 'Application'
  | 'Prompt'
  | 'History'
  | 'Transcript'
  | 'Queue'
  | 'Navigation'
  | 'Appearance'
  | 'Other'

export type ActionDefinition = {
  id: string
  title: string
  description: string
  category: ActionCategory
  context: string
  keywords: readonly string[]
}

const OVERRIDES: Record<
  string,
  Partial<Omit<ActionDefinition, 'id'>>
> = {
  'app:commandPalette': {
    title: 'Open command palette',
    description: 'Search actions, commands, and skills',
    category: 'Application',
    context: 'Global',
    keywords: ['actions', 'commands', 'skills', 'search'],
  },
  'app:queue': {
    title: 'Open interactive queue',
    description: 'Inspect, edit, reorder, remove, or send queued prompts',
    category: 'Queue',
    context: 'Global',
    keywords: ['pending', 'prompts', 'send next'],
  },
  'chat:undo': {
    title: 'Undo prompt edit',
    description: 'Restore the previous prompt state, including attachments',
    category: 'Prompt',
    context: 'Chat',
    keywords: ['editor', 'history'],
  },
  'chat:redo': {
    title: 'Redo prompt edit',
    description: 'Reapply an undone prompt edit',
    category: 'Prompt',
    context: 'Chat',
    keywords: ['editor', 'history'],
  },
  'app:toggleTranscript': {
    title: 'Toggle transcript',
    description: 'Open or close the fullscreen conversation view',
    category: 'Transcript',
    context: 'Global',
    keywords: ['scrollback', 'fullscreen'],
  },
}

function sentenceCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, char => char.toUpperCase())
}

function inferCategory(action: string): ActionCategory {
  const prefix = action.split(':', 1)[0]
  if (prefix === 'app') return 'Application'
  if (prefix === 'chat') return 'Prompt'
  if (prefix.startsWith('history')) return 'History'
  if (prefix === 'transcript' || prefix === 'scroll' || prefix === 'selection')
    return 'Transcript'
  if (prefix === 'queue') return 'Queue'
  if (prefix === 'theme' || prefix === 'settings') return 'Appearance'
  if (
    ['tabs', 'footer', 'attachments', 'messageSelector', 'select'].includes(
      prefix,
    )
  )
    return 'Navigation'
  return 'Other'
}

function inferContext(action: string): string {
  const prefix = action.split(':', 1)[0]
  if (prefix === 'app') return 'Global'
  if (prefix === 'chat' || prefix === 'history') return 'Chat'
  if (prefix === 'transcript') return 'Transcript'
  if (prefix === 'queue') return 'Queue'
  return 'Global'
}

export const ACTION_REGISTRY: readonly ActionDefinition[] =
  KEYBINDING_ACTIONS.map(id => {
    const [, name = id] = id.split(':')
    const override = OVERRIDES[id]
    return {
      id,
      title: override?.title ?? sentenceCase(name),
      description:
        override?.description ?? `Run the ${sentenceCase(name).toLowerCase()} action`,
      category: override?.category ?? inferCategory(id),
      context: override?.context ?? inferContext(id),
      keywords: override?.keywords ?? [],
    }
  })

const ACTIONS_BY_ID = new Map(ACTION_REGISTRY.map(action => [action.id, action]))

export function getActionDefinition(id: string): ActionDefinition | undefined {
  return ACTIONS_BY_ID.get(id)
}

