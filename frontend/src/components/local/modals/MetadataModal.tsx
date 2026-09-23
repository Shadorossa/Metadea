import React from 'react';
import { getT } from '../../../i18n/runtime';
import type { Translations } from '../../../i18n/index';
import { ModalShell } from '../../shared/ModalShell';
import { formatAppError } from '../../../lib/errors/format-error';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { errorNeedsIgdbKeys, type MetadataFetchOutcome, type MetadataFetchSummary } from '../../../lib/local/metadata-fetch';

export interface MetaProgress {
  total:       number;
  current:     number;
  currentName: string;
  cancelled:   boolean;
}

interface MetadataModalProps {
  progress: MetaProgress;
  // Set once the run has ended with something to say (an error, or games
  // that did not get their metadata): the modal shows it instead of the bar.
  outcome?: MetadataFetchOutcome | null;
  onCancel: () => void;
  onClose: () => void;
  onRetrySkipped?: () => void;
}

const ENVIRONMENT_SETTINGS_URL = '/settings?tab=environment&platform=igdb';

type LocalStrings = Translations['local'];
const SUMMARY_LINES: { key: keyof MetadataFetchSummary; label: (t: LocalStrings) => string }[] = [
  { key: 'done',               label: t => t.meta_summary_done },
  { key: 'cached',             label: t => t.meta_summary_cached },
  { key: 'notFound',           label: t => t.meta_summary_not_found },
  { key: 'skipped',            label: t => t.meta_summary_skipped },
  { key: 'failed',             label: t => t.meta_summary_failed },
  { key: 'achievementsFailed', label: t => t.meta_summary_achievements_failed },
];

export function MetadataModal({ progress, outcome, onCancel, onClose, onRetrySkipped }: MetadataModalProps) {
  const t = getT();
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  if (outcome) {
    const title = outcome.error ? t.local.meta_failed_title : t.local.meta_summary_title;
    return (
      <ModalShell
        onClose={onClose}
        label={title}
        overlayClassName="meta-modal-overlay"
        panelClassName="meta-modal"
        portal={false}
        stopPanelPropagation={false}
      >
        <h3 className="meta-modal-title">{title}</h3>
        {outcome.error && <p className="meta-modal-subtitle" role="alert">{formatAppError(outcome.error, t)}</p>}
        {SUMMARY_LINES.filter(line => outcome.summary[line.key] > 0).map(line => (
          <p key={line.key} className="meta-modal-count">{interpolate(line.label(t.local), { n: outcome.summary[line.key] })}</p>
        ))}
        <div className="meta-modal-actions">
          <button type="button" className="meta-modal-cancel" onClick={onClose}>{t.local.meta_close}</button>
          {errorNeedsIgdbKeys(outcome.error) && (
            <a className="meta-modal-confirm" href={ENVIRONMENT_SETTINGS_URL}>{t.local.meta_open_environment}</a>
          )}
          {!outcome.error && outcome.summary.skipped > 0 && onRetrySkipped && (
            <button type="button" className="meta-modal-confirm" onClick={onRetrySkipped}>{t.local.meta_retry_skipped}</button>
          )}
        </div>
      </ModalShell>
    );
  }

  // A progress dialog for an in-flight batch: neither the backdrop nor
  // Escape aborts it (same as before) — only the Cancel button, which the
  // shell focuses on open so a keyboard user can reach it.
  return (
    <ModalShell
      onClose={onCancel}
      label={t.local.updating_metadata}
      overlayClassName="meta-modal-overlay"
      panelClassName="meta-modal"
      closeOnBackdrop={false}
      closeOnEscape={false}
      portal={false}
      stopPanelPropagation={false}
    >
        <h3 className="meta-modal-title">{t.local.updating_metadata}</h3>
        <p className="meta-modal-subtitle">{progress.currentName || t.local.meta_starting}</p>
        <div className="meta-modal-bar-track">
          <div className="meta-modal-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="meta-modal-count">{progress.current} / {progress.total}</p>
        <button type="button" className="meta-modal-cancel" onClick={onCancel}>{t.local.cancel}</button>
    </ModalShell>
  );
}
