// The spoiler shield's visual pieces, one look everywhere (styles/components/
// spoiler-shield.css, matching the biography's `.spoiler` spans): a blurred
// block with a "Spoiler · Reveal" chip, the chip alone for cards that blur
// their own images, an inline blurred span, and the character page banner.
// Hidden content is aria-hidden and inert, so neither screen readers nor the
// keyboard reach it before it is revealed.
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { getT } from '../../i18n/runtime';
import { interpolate } from '../../lib/shared/text/interpolate';

type SpoilerStrings = ReturnType<typeof getT>['spoilers'];

function activate(event: MouseEvent | KeyboardEvent, onReveal: () => void) {
  // Chips sit inside cards that are links; revealing must not navigate.
  event.preventDefault();
  event.stopPropagation();
  onReveal();
}

function onActivationKey(event: KeyboardEvent, onReveal: () => void) {
  if (event.key === 'Enter' || event.key === ' ') activate(event, onReveal);
}

interface ChipProps {
  onReveal: () => void;
  /** Text before "· Reveal"; "Spoiler" by default. */
  label?: string;
  /** `span` inside cards that are themselves links (no button in an <a>). */
  element?: 'button' | 'span';
  className?: string;
}

export function SpoilerChip({ onReveal, label, element = 'button', className }: ChipProps) {
  const t = getT().spoilers;
  const content = (
    <>
      <span className="spoiler-shield-chip-label">{label ?? t.chip}</span>
      <span aria-hidden="true"> · </span>
      <span className="spoiler-shield-chip-action">{t.reveal}</span>
    </>
  );
  const classes = `spoiler-shield-chip${className ? ` ${className}` : ''}`;
  if (element === 'span') {
    return (
      <span
        role="button"
        tabIndex={0}
        className={classes}
        aria-label={t.chip_aria}
        title={t.chip_aria}
        onClick={event => activate(event, onReveal)}
        onKeyDown={event => onActivationKey(event, onReveal)}
      >
        {content}
      </span>
    );
  }
  return (
    <button type="button" className={classes} aria-label={t.chip_aria} title={t.chip_aria} onClick={event => activate(event, onReveal)}>
      {content}
    </button>
  );
}

interface ShieldProps {
  hidden: boolean;
  onReveal: () => void;
  label?: string;
  className?: string;
  children: ReactNode;
}

/** A block (synopsis, biography, arc card) blurred under a centred chip. */
export function SpoilerShield({ hidden, onReveal, label, className, children }: ShieldProps) {
  if (!hidden) return <>{children}</>;
  return (
    <div className={`spoiler-shield is-hidden${className ? ` ${className}` : ''}`}>
      <div className="spoiler-shield-content" aria-hidden="true" inert>
        {children}
      </div>
      <SpoilerChip onReveal={onReveal} label={label} />
    </div>
  );
}

/** A word or line (a stat value, an episode title) hidden in place, as the
 *  biography's `.spoiler` pill. Without children the pill reads
 *  "Spoiler · Reveal" and the hidden text is not in the DOM at all. */
export function SpoilerInline({ hidden, onReveal, children }: { hidden: boolean; onReveal: () => void; children?: ReactNode }) {
  const t = getT().spoilers;
  if (!hidden) return <>{children}</>;
  const labelled = children === undefined;
  return (
    <span
      role="button"
      tabIndex={0}
      className={`spoiler-shield-inline${labelled ? ' spoiler-shield-inline--labelled' : ''}`}
      aria-label={t.chip_aria}
      title={t.chip_aria}
      onClick={event => activate(event, onReveal)}
      onKeyDown={event => onActivationKey(event, onReveal)}
    >
      {labelled
        ? <>{t.chip}<span aria-hidden="true"> · </span><span className="spoiler-shield-chip-action">{t.reveal}</span></>
        : <span aria-hidden="true">{children}</span>}
    </span>
  );
}

interface BannerProps {
  franchiseName: string;
  /** "Appears in <work>" for a late-debut character. */
  note?: string | null;
  onRevealPage: () => void;
  onRevealFranchise: () => void;
}

export function SpoilerBanner({ franchiseName, note, onRevealPage, onRevealFranchise }: BannerProps) {
  const t: SpoilerStrings = getT().spoilers;
  return (
    <div className="spoiler-banner" role="note">
      <svg className="spoiler-banner-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <span className="spoiler-banner-text">
        {interpolate(t.banner, { franchise: franchiseName })}
        {note && <span className="spoiler-banner-note"> · {note}</span>}
      </span>
      <span className="spoiler-banner-actions">
        <button type="button" className="spoiler-banner-btn" onClick={onRevealPage}>{t.reveal}</button>
        <button type="button" className="spoiler-banner-btn spoiler-banner-btn--secondary" onClick={onRevealFranchise}>
          {interpolate(t.banner_reveal_franchise, { franchise: franchiseName })}
        </button>
      </span>
    </div>
  );
}
