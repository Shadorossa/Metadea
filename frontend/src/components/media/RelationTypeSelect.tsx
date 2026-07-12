import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface RelationTypeSelectProps {
  value:        string;
  options:      string[];
  labels:       Record<string, string>;
  /** A pre-existing relation type outside the curated `options` list (e.g.
   *  CHARACTER, OTHER) — shown as an extra, still-selectable entry so the
   *  dropdown doesn't silently snap away from it on first render. */
  extraOption?: { value: string; label: string };
  onChange:     (value: string) => void;
}

// Native <select> popups can't be styled beyond option text/background on
// Windows/Chromium — no row spacing, no rounded corners, no custom hover
// color — which is what made the relation-type list look cramped and
// generic. This renders the same list as our own panel instead, portaled to
// <body> (the editor modal has `overflow: hidden` for its rounded corners,
// which would otherwise clip the panel for any card near its edge) and
// positioned under the trigger via a measured rect.
export function RelationTypeSelect({ value, options, labels, extraOption, onChange }: RelationTypeSelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const openPanel = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Any scroll *outside* the panel (modal body, page, etc.) invalidates
    // the measured rect — simplest correct behavior is to just close rather
    // than track it live. Scrolling *inside* the panel's own option list
    // must NOT close it, or the list becomes impossible to scroll at all.
    const handleScroll = (e: Event) => {
      if (!panelRef.current) return;
      const target = e.target as HTMLElement;
      // If the scroll happened inside the dropdown panel, do NOT close it!
      if (panelRef.current === target || panelRef.current.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const allOptions = extraOption && !options.includes(extraOption.value)
    ? [extraOption.value, ...options]
    : options;

  const currentLabel = value === extraOption?.value ? extraOption.label : (labels[value] || value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="rel-type-select-trigger"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="rel-type-select-value">{currentLabel}</span>
        <svg width="9" height="9" viewBox="0 0 12 12" className="rel-type-select-chevron">
          <path fill="currentColor" d="M2.5 4.5l3.5 3.5 3.5-3.5z" />
        </svg>
      </button>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          className="rel-type-select-panel"
          role="listbox"
          style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
        >
          {allOptions.map(opt => {
            const label = opt === extraOption?.value ? extraOption.label : (labels[opt] || opt);
            return (
              <button
                type="button"
                key={opt}
                role="option"
                aria-selected={opt === value}
                className={`rel-type-select-option${opt === value ? ' active' : ''}`}
                onClick={() => { onChange(opt); setOpen(false); }}
              >
                {label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
