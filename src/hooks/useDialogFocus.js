import { useLayoutEffect, useRef } from 'react'
import { lockBodyScroll } from '../lib/bodyScroll'

export default function useDialogFocus(ref, { onClose, busy, enabled = true }) {
  const previousFocus = useRef(null)
  const current = useRef({ onClose, busy })
  current.current = { onClose, busy }
  useLayoutEffect(() => {
    const node = ref.current
    if (!enabled || !node) return undefined
    previousFocus.current = document.activeElement
    const unlock = lockBodyScroll()
    const focusable = () => [...node.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.disabled && element.getClientRects().length)
    ;(node.querySelector('[data-initial-focus]:not(:disabled)') ?? focusable()[0] ?? node).focus()
    const keydown = event => {
      const dialogs = document.querySelectorAll('.modal-overlay .modal')
      if (dialogs[dialogs.length - 1] !== node) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!current.current.busy) current.current.onClose?.()
      } else if (event.key === 'Tab') {
        const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1]
        if (!first) { event.preventDefault(); node.focus() }
        else if (!node.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      unlock()
      if (previousFocus.current?.isConnected && (document.activeElement === document.body || node.contains(document.activeElement))) previousFocus.current.focus()
    }
  }, [ref, enabled])
}
