// "What's new" modal: renders parsed CHANGELOG.md releases (lib/changelog/)
// as compact collapsible groups — Highlights (open) / New / Improved / Fixed
// (collapsed behind their counts), each fix with its cause. Two modes:
//   - 'unseen': the releases the user has not acknowledged yet (opened on
//     app start by ChangelogLauncher), paged with Previous/Next, "Got it".
//   - 'all':    every release with a version selector (Settings › Environment
//     › "View changelog", or "View all versions" from the unseen mode).
// The notes are English-only by design; only the chrome goes through i18n.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bug, ChevronDown, ChevronLeft, ChevronRight, Plus, Sparkles, Star, TrendingUp, X } from 'lucide-react';
import { getLangCode, getT } from '../../i18n/runtime';
import { interpolateTranslation } from '../../lib/i18n-dom/apply-translations';
import {
  parseInline,
  type ChangelogEntry,
  type ChangelogFix,
  type ChangelogRelease,
} from '../../lib/changelog/parse-changelog';
import { ModalShell } from '../shared/ModalShell';

export type ChangelogModalMode = 'unseen' | 'all';

interface ChangelogModalProps {
  releases: readonly ChangelogRelease[];
  mode: ChangelogModalMode;
  onClose: () => void;
  /** 'unseen' mode: switch to the full history. */
  onViewAll?: () => void;
}

function formatReleaseDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  try {
    return new Intl.DateTimeFormat(getLangCode(), { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  } catch {
    return iso;
  }
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, index) => {
        switch (token.kind) {
          case 'bold': return <strong key={index}>{token.text}</strong>;
          case 'code': return <code key={index} className="changelog-code">{token.text}</code>;
          case 'link': return <a key={index} href={token.href} target="_blank" rel="noreferrer">{token.text}</a>;
          default: return <span key={index}>{token.text}</span>;
        }
      })}
    </>
  );
}

type SectionTone = 'highlights' | 'added' | 'improved' | 'fixed';

// Collapsible group (native <details>): Highlights starts open, the rest
// collapsed behind their counts so a long release stays one screen tall.
function Section({ tone, icon, title, count, defaultOpen = false, children }: {
  tone: SectionTone;
  icon: ReactNode;
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={`changelog-section changelog-section--${tone}`} open={defaultOpen}>
      <summary className="changelog-section-summary">
        <span className="changelog-section-icon" aria-hidden="true">{icon}</span>
        <span className="changelog-section-title">{title}</span>
        <span className="changelog-section-count">{count}</span>
        <ChevronDown className="changelog-section-chevron" size={14} aria-hidden="true" />
      </summary>
      <ul className="changelog-items">{children}</ul>
    </details>
  );
}

function EntryItem({ entry }: { entry: ChangelogEntry }) {
  return (
    <li className="changelog-item">
      {entry.title && <span className="changelog-item-area"><InlineText text={entry.title} /></span>}
      <span className="changelog-item-text"><InlineText text={entry.text} /></span>
    </li>
  );
}

function FixItem({ fix, causeLabel }: { fix: ChangelogFix; causeLabel: string }) {
  return (
    <li className="changelog-item changelog-item--fix">
      <span className="changelog-item-text"><InlineText text={fix.summary} /></span>
      {fix.cause && (
        <span className="changelog-item-cause">
          {causeLabel} <InlineText text={fix.cause} />
        </span>
      )}
    </li>
  );
}

function ReleaseBody({ release }: { release: ChangelogRelease }) {
  const t = getT().changelog;
  return (
    <>
      {release.highlights.length > 0 && (
        <Section tone="highlights" icon={<Star size={13} />} title={t.section_highlights} count={release.highlights.length} defaultOpen>
          {release.highlights.map((text, index) => (
            <li key={index} className="changelog-item"><span className="changelog-item-text"><InlineText text={text} /></span></li>
          ))}
        </Section>
      )}
      {release.added.length > 0 && (
        <Section tone="added" icon={<Plus size={13} />} title={t.section_added} count={release.added.length}>
          {release.added.map((entry, index) => <EntryItem key={index} entry={entry} />)}
        </Section>
      )}
      {release.improved.length > 0 && (
        <Section tone="improved" icon={<TrendingUp size={13} />} title={t.section_improved} count={release.improved.length}>
          {release.improved.map((entry, index) => <EntryItem key={index} entry={entry} />)}
        </Section>
      )}
      {release.fixed.length > 0 && (
        <Section tone="fixed" icon={<Bug size={13} />} title={t.section_fixed} count={release.fixed.length}>
          {release.fixed.map((fix, index) => <FixItem key={index} fix={fix} causeLabel={t.cause_label} />)}
        </Section>
      )}
    </>
  );
}

export function ChangelogModal({ releases, mode, onClose, onViewAll }: ChangelogModalProps) {
  const t = getT().changelog;
  const [index, setIndex] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const release = releases[Math.min(index, releases.length - 1)];

  // A new page starts at its top.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [index, mode]);

  const title = release && mode === 'unseen'
    ? interpolateTranslation(t.title_version, { version: release.version })
    : t.title;
  const paged = releases.length > 1;

  return (
    <ModalShell
      onClose={onClose}
      label={title}
      overlayClassName="changelog-overlay"
      panelClassName="changelog-panel"
    >
      <header className="changelog-header">
        <span className="changelog-header-icon" aria-hidden="true"><Sparkles size={16} /></span>
        <div className="changelog-header-text">
          <h2 className="changelog-title">{title}</h2>
          {release && (
            <div className="changelog-meta">
              <span className="changelog-version-pill">v{release.version}</span>
              {release.date && (
                <time dateTime={release.date}>
                  {interpolateTranslation(t.released_on, { date: formatReleaseDate(release.date) })}
                </time>
              )}
            </div>
          )}
        </div>
        <button type="button" className="changelog-close" onClick={onClose} aria-label={t.close}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {mode === 'all' && paged && (
        <div className="changelog-versions" role="tablist" aria-label={t.versions_label}>
          {releases.map((r, i) => (
            <button
              key={r.version}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`changelog-version-tab${i === index ? ' changelog-version-tab--active' : ''}`}
              onClick={() => setIndex(i)}
            >
              v{r.version}
            </button>
          ))}
        </div>
      )}

      <div className="changelog-body" ref={bodyRef}>
        {release ? <ReleaseBody key={release.version} release={release} /> : <p className="changelog-empty">{t.empty}</p>}
      </div>

      <footer className="changelog-footer">
        {paged && (
          <div className="changelog-pager">
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0}
            >
              <ChevronLeft size={14} aria-hidden="true" /> {t.previous}
            </button>
            <span className="changelog-pager-position">
              {interpolateTranslation(t.position, { current: index + 1, total: releases.length })}
            </span>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={() => setIndex(i => Math.min(releases.length - 1, i + 1))}
              disabled={index >= releases.length - 1}
            >
              {t.next} <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="changelog-actions">
          {mode === 'unseen' && onViewAll && (
            <button type="button" className="btn btn--sm btn--secondary" onClick={onViewAll}>{t.view_all}</button>
          )}
          <button type="button" className="btn btn--sm btn--primary" onClick={onClose}>{t.got_it}</button>
        </div>
      </footer>
    </ModalShell>
  );
}
