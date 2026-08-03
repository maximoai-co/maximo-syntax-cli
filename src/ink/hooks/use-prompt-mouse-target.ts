import { useCallback, useLayoutEffect, useRef } from 'react'
import instances from '../instances.js'
import type { DOMElement } from '../dom.js'
import type { PromptMouseHandler } from '../prompt-mouse.js'

/**
 * Register a rendered Box as a prompt mouse target.
 *
 * The callback is kept in a ref so a keystroke does not cause terminal mouse
 * modes to be torn down and re-enabled. The DOM node itself is registered in
 * a layout effect, after Ink has attached the ref and populated its layout.
 */
export function usePromptMouseTarget(
  handler: PromptMouseHandler,
  enabled = true,
): (node: DOMElement | null) => void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const nodeRef = useRef<DOMElement | null>(null)
  const registeredNodeRef = useRef<DOMElement | null>(null)
  const unregisterRef = useRef<(() => void) | null>(null)

  const setNode = useCallback((node: DOMElement | null) => {
    nodeRef.current = node
    if (!node) {
      unregisterRef.current?.()
      unregisterRef.current = null
      registeredNodeRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!enabled) {
      unregisterRef.current?.()
      unregisterRef.current = null
      registeredNodeRef.current = null
      return
    }
    const ink = instances.get(process.stdout)
    const node = nodeRef.current
    if (!ink || !node || registeredNodeRef.current === node) return

    unregisterRef.current?.()
    const unregister = ink.registerPromptMouseTarget(node, event => {
      handlerRef.current(event)
    })
    unregisterRef.current = unregister
    registeredNodeRef.current = node
  })

  useLayoutEffect(() => {
    return () => {
      unregisterRef.current?.()
      unregisterRef.current = null
      registeredNodeRef.current = null
    }
  }, [])

  return setNode
}
