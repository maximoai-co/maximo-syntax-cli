import { parseReferences } from '../history.js'
import type { PastedContent } from './config.js'

export type AtomicPromptState = {
  text: string
  pastedContents: Record<number, PastedContent>
}

export type MergedAtomicPromptState = AtomicPromptState & {
  cursorOffset: number
}

function numericIds(contents: Record<number, PastedContent>): number[] {
  return Object.keys(contents)
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0)
}

/**
 * Prepend a queued prompt without allowing its attachment IDs to collide with
 * IDs already present in the editor. Reference labels and PastedContent.id are
 * rebased together, keeping each image/paste chip atomic and correctly wired.
 */
export function prependAtomicPromptState(
  incoming: AtomicPromptState,
  current: AtomicPromptState,
): MergedAtomicPromptState {
  const usedIds = new Set([
    ...numericIds(current.pastedContents),
    ...parseReferences(current.text).map(reference => reference.id),
  ])
  let nextId = Math.max(0, ...usedIds) + 1
  const idMap = new Map<number, number>()
  const rebasedContents: Record<number, PastedContent> = {}

  for (const oldId of numericIds(incoming.pastedContents).sort((a, b) => a - b)) {
    let newId = oldId
    if (usedIds.has(newId)) {
      while (usedIds.has(nextId)) nextId++
      newId = nextId++
    }
    usedIds.add(newId)
    idMap.set(oldId, newId)
    rebasedContents[newId] = {
      ...incoming.pastedContents[oldId]!,
      id: newId,
    }
  }

  let incomingText = incoming.text
  const references = parseReferences(incomingText)
  for (let index = references.length - 1; index >= 0; index--) {
    const reference = references[index]!
    const newId = idMap.get(reference.id)
    if (!newId || newId === reference.id) continue
    const replacement = reference.match.replace(
      `#${reference.id}`,
      `#${newId}`,
    )
    incomingText =
      incomingText.slice(0, reference.index) +
      replacement +
      incomingText.slice(reference.index + reference.match.length)
  }

  const separator = incomingText && current.text ? '\n' : ''
  return {
    text: incomingText + separator + current.text,
    cursorOffset: incomingText.length,
    pastedContents: {
      ...current.pastedContents,
      ...rebasedContents,
    },
  }
}
