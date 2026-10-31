import { useEffect, useId, useRef, useState } from 'react'

// Render the menu in the page: native Windows select popups can ignore dark styling.
export default function BranchSwitcher({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  const wrap = useRef(null)
  const trigger = useRef(null)
  const search = useRef({ text: '', at: 0 })
  const selected = options.findIndex(option => option.value === value)
  const selectedOption = options[selected]

  useEffect(() => {
    if (!open) return undefined
    const outside = event => { if (!wrap.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])
  useEffect(() => { setOpen(false) }, [value])

  const show = (index = Math.max(0, selected)) => { setActive(index); setOpen(true) }
  const choose = index => {
    const next = options[index]
    if (next && next.value !== value) onChange(next.value)
    setOpen(false)
  }
  const keydown = event => {
    if (event.key === 'Escape') { if (open) event.preventDefault(); setOpen(false); return }
    if (event.key === 'Tab') { setOpen(false); return }
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault()
      if (open) choose(active)
      else show()
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!options.length) return
      if (!open) show(event.key === 'End' ? options.length - 1 : event.key === 'Home' ? 0 : Math.max(0, selected))
      else setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      search.current.text = (now - search.current.at > 700 ? '' : search.current.text) + event.key.toLowerCase()
      search.current.at = now
      const index = options.findIndex(option => option.label.toLowerCase().startsWith(search.current.text))
      if (index >= 0) { event.preventDefault(); show(index) }
    }
  }

  return (
    <div ref={wrap} className="branch-switcher">
      <button ref={trigger} type="button" role="combobox" className="branch-trigger"
        aria-label="Working branch" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={`${id}-list`} aria-activedescendant={open ? `${id}-${active}` : undefined}
        onKeyDown={keydown} onClick={() => open ? setOpen(false) : show()}
        onBlur={event => { if (!wrap.current?.contains(event.relatedTarget)) setOpen(false) }}>
        <span>{selectedOption?.label ?? 'Choose a branch'}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && <div className="branch-options" id={`${id}-list`} role="listbox" aria-label="Branches">
        {options.map((option, index) => (
          <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value}
            className={`branch-option${active === index ? ' highlighted' : ''}`}
            onPointerMove={() => setActive(index)}
            onPointerDown={event => event.preventDefault()}
            onClick={() => { choose(index); trigger.current?.focus() }}>
            <span>{option.label}</span><span aria-hidden="true">{option.value === value ? '✓' : ''}</span>
          </div>
        ))}
      </div>}
    </div>
  )
}
