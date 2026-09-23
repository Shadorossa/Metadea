import { useEffect, useId, useRef, useState } from 'react';
import { EINK_BRIGHTNESS_RANGE, EINK_WARMTH_RANGE, type EinkPreferences } from '../../lib/reader/eink-mode';
import { getT } from '../../i18n/runtime';

interface Props {
  prefs: EinkPreferences;
  onChange: (patch: Partial<EinkPreferences>) => void;
}

// Night controls of a reader's header: a moon button opening a small
// popover with the E-Ink / paper mode switch, warmth, paper brightness and
// the refresh flash. Escape and outside clicks close the popover before the
// reader's own Escape (fullscreen, then close) gets the key.
export function ReaderNightControls({ prefs, onChange }: Props) {
  const t = getT().reader;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !e.composedPath().includes(wrapRef.current)) setOpen(false);
    };
    // Capture on window runs before the readers' bubbling Escape handlers.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const warmthPercent = Math.round(prefs.warmth * 100);
  const brightnessPercent = Math.round(prefs.brightness * 100);

  return (
    <div className="reader-night" ref={wrapRef}>
      <button
        type="button"
        className={`comic-reader-header-btn${open || prefs.enabled ? ' is-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={t.night_controls_title}
        aria-label={t.night_controls_title}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>

      {open && (
        <div className="reader-night-popover" id={popoverId} role="dialog" aria-label={t.night_controls_title} onClick={e => e.stopPropagation()}>
          <div className="reader-night-title">{t.night_controls_title}</div>

          <label className="reader-night-row reader-night-row--toggle">
            <span>
              <span className="reader-night-label">{t.eink_mode}</span>
              <span className="reader-night-hint">{t.eink_mode_hint}</span>
            </span>
            <input type="checkbox" role="switch" className="reader-night-switch" checked={prefs.enabled} onChange={e => onChange({ enabled: e.target.checked })} />
          </label>

          <label className="reader-night-row">
            <span className="reader-night-label">
              {t.eink_warmth}
              <span className="reader-night-value">{warmthPercent === 0 ? t.eink_warmth_neutral : `${warmthPercent}%`}</span>
            </span>
            <input
              type="range"
              min={EINK_WARMTH_RANGE.min}
              max={EINK_WARMTH_RANGE.max}
              step={EINK_WARMTH_RANGE.step}
              value={prefs.warmth}
              disabled={!prefs.enabled}
              onChange={e => onChange({ warmth: Number(e.target.value) })}
            />
            <span className="reader-night-scale" aria-hidden="true">
              <span>{t.eink_warmth_neutral}</span>
              <span>{t.eink_warmth_amber}</span>
            </span>
          </label>

          <label className="reader-night-row">
            <span className="reader-night-label">
              {t.eink_brightness}
              <span className="reader-night-value">{brightnessPercent}%</span>
            </span>
            <input
              type="range"
              min={EINK_BRIGHTNESS_RANGE.min}
              max={EINK_BRIGHTNESS_RANGE.max}
              step={EINK_BRIGHTNESS_RANGE.step}
              value={prefs.brightness}
              disabled={!prefs.enabled}
              onChange={e => onChange({ brightness: Number(e.target.value) })}
            />
          </label>

          <label className="reader-night-row reader-night-row--toggle">
            <span>
              <span className="reader-night-label">{t.eink_refresh_flash}</span>
              <span className="reader-night-hint">{t.eink_refresh_flash_hint}</span>
            </span>
            <input type="checkbox" role="switch" className="reader-night-switch" checked={prefs.refreshFlash} disabled={!prefs.enabled} onChange={e => onChange({ refreshFlash: e.target.checked })} />
          </label>

          <p className="reader-night-footnote">{t.eink_shortcut_hint}</p>
        </div>
      )}
    </div>
  );
}
