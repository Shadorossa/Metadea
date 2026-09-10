import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '../../lib/shared/useEscapeKey';
import type { RelationOptionGroup } from '../../lib/media/sagaTypes';

interface RelationTypeSelectProps {
  value:        string;
  /** Pre-grouped via sagaTypes.ts's groupRelationOptions — each group's own
   *  header names the label the OTHER work ends up showing once you pick
   *  one of its options (e.g. everything under "Source Material" makes the
   *  other side show that). The trailing group with an empty header (if
   *  any) holds options with no defined reciprocal, rendered without a
   *  header of their own. */
  groups:       RelationOptionGroup[];
  labels:       Record<string, string>;
  /** A pre-existing relation type outside the curated `groups` (e.g.
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
export function RelationTypeSelect({ value, groups, labels, extraOption, onChange }: RelationTypeSelectProps) {
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
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);
  useEscapeKey(open, () => setOpen(false));

  const hasExtra = extraOption && !groups.some(g => g.options.includes(extraOption.value));
  const allGroups: RelationOptionGroup[] = hasExtra
    ? [...groups, { header: '', options: [extraOption.value] }]
    : groups;

  // `labels` (the canonical/localized dictionary) wins whenever it actually
  // has this value — e.g. ADAPTATION and REL_ADAPTATION are the same concept
  // to a curator and must always read identically, regardless of whatever
  // raw text got stored in this specific row's own type_label historically
  // (different app-language sessions saved different literal words there).
  // extraOption.label is only the fallback, for values truly outside the
  // dictionary (CHARACTER, OTHER, ...).
  const currentLabel = labels[value] || (value === extraOption?.value ? extraOption.label : value);

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
          {allGroups.map((group, groupIndex) => (
            <div className="rel-type-select-group" key={group.header || `ungrouped-${groupIndex}`}>
              {group.header && (
                <div className="rel-type-select-group-header">{group.header}</div>
              )}
              {group.options.map(opt => {
                const label = labels[opt] || (opt === extraOption?.value ? extraOption.label : opt);
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
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
