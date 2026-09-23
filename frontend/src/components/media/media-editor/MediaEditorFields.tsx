import React from 'react';
import { useKeyedState } from '../../shared/hooks/useKeyedState';
import { formatHoursColon, parseHoursColonInput } from './media-editor-helpers';

export function HeaderField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`me-header-field${className ? ` ${className}` : ''}`}>
      <label className="me-header-field-label">{label}</label>
      {children}
    </div>
  );
}

export function HoursField({ label, value, max, onChange }: {
  label: string; value: number; max?: number; onChange: (v: number) => void;
}) {
  const formatted = formatHoursColon(value);
  // Local draft text, not tied directly to `value` on every keystroke — a
  // controlled input re-deriving its display from the parsed number as you
  // type would reformat (and jump the cursor) mid-entry, e.g. typing "10:3"
  // toward "10:30" briefly parses as "10:03" and rewrites itself. Only
  // resynced from outside changes (switching log/version) and on blur.
  const [text, setText] = useKeyedState(formatted, formatted);

  function commit() {
    const parsed = parseHoursColonInput(text);
    if (parsed === null) { setText(formatted); return; }
    onChange(max !== undefined && parsed > max ? max : parsed);
  }

  return (
    <HeaderField label={label} className="me-header-field--hours">
      <div className="me-header-field-row">
        <input type="text" inputMode="numeric" className="me-header-field-input me-header-field-input--number"
          value={text}
          onChange={e => {
            // Digits and at most one ":" — comma (or anything else) is
            // rejected right at the keystroke rather than silently eaten
            // later. Minutes >= 60 typed mid-entry (e.g. "1:9" on the way to
            // "1:59") aren't blocked here — parseHoursColonInput rejects
            // them for good on blur instead, since a bare "9" can't yet know
            // whether it'll become a valid "09" or an invalid "90".
            const next = e.target.value;
            if (/^\d*(:\d{0,2})?$/.test(next)) setText(next);
          }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="0:00" />
        {/* Always rendered (reserved min-width, hidden via CSS when there's
            no max) — switching to a tab whose total isn't known yet must
            never shift whatever sits after this field. */}
        <span className={`me-header-field-max${max === undefined ? ' me-header-field-max--hidden' : ''}`}>
          / {max !== undefined ? formatHoursColon(max) : ''}
        </span>
      </div>
    </HeaderField>
  );
}

export function NumberField({ label, value, max, step, disabled, unknownMax, onChange }: {
  label: string; value: number; max?: number; step: number; disabled?: boolean; unknownMax?: boolean; onChange: (v: number) => void;
}) {
  return (
    <HeaderField label={label}>
      <div className="me-header-field-row">
        <input type="number" className="me-header-field-input me-header-field-input--number" min={0}
          max={max} step={step} disabled={disabled}
          value={value || ''}
          onChange={e => {
            let v = parseFloat(e.target.value) || 0;
            if (max !== undefined && v > max) v = max;
            onChange(v);
          }}
          placeholder="0" />
        {/* Same always-rendered reserved slot as HoursField above. */}
        <span className={`me-header-field-max${max === undefined && !unknownMax ? ' me-header-field-max--hidden' : ''}`}>
          / {max !== undefined ? max : unknownMax ? '?' : ''}
        </span>
      </div>
    </HeaderField>
  );
}
