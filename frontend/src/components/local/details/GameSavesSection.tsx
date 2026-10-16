import React, { useCallback, useEffect, useMemo, useState } from 'react';
import '../../../styles/pages/local/saves.css';
import { getT } from '../../../i18n/runtime';
import { getLocaleCode } from '../../../lib/shared/text/format-date';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { formatAppError } from '../../../lib/errors/format-error';
import { formatBytes } from '../../../lib/backup/backup-settings';
import { formatAbsoluteTime, formatRelativeTime, groupSaves } from '../../../lib/local/save-format';
import {
  archiveSave, listGameSaves, onSavesChanged, openSavesFolder, restoreSaveVersion, setSaveLabel, syncSavesNow,
  type GameSaves, type SaveEntry, type SaveGameRef,
} from '../../../lib/tauri/saves';

interface GameSavesSectionProps {
  platformId: string;
  romPath: string;
  title: string;
}

type Status = { text: string; tone: 'info' | 'error' } | null;

const currentTime = () => Date.now();

function formatVersionDate(timestampMs: number) {
  const date = new Date(timestampMs);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/'${year}`;
}

function IconFolder() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCloud({ synced }: { synced: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      {synced ? <path d="m9 14 2 2 4-4" /> : <path d="M12 12v4M12 18h.01" />}
    </svg>
  );
}

function IconArchive() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" />
    </svg>
  );
}

function IconBattery() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}

function IconState() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

function SaveLabel({ entry, onSave }: { entry: SaveEntry; onSave: (label: string | null) => Promise<void> }) {
  const t = getT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.label ?? '');

  const commit = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next === (entry.label ?? '')) return;
    await onSave(next === '' ? null : next);
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="game-saves-label-input"
        value={draft}
        maxLength={120}
        placeholder={t.saves.label_placeholder}
        aria-label={t.saves.label_edit}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => { void commit(); }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); void commit(); }
          if (event.key === 'Escape') { event.preventDefault(); setDraft(entry.label ?? ''); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={`game-saves-label${entry.label ? '' : ' game-saves-label--empty'}`}
      onClick={() => { setDraft(entry.label ?? ''); setEditing(true); }}
      title={t.saves.label_edit}
    >
      {entry.label || t.saves.label_add}
    </button>
  );
}

function SaveRow({ entry, now, driveSync, busy, onLabel, onRestore, onArchive }: {
  entry: SaveEntry;
  now: number;
  driveSync: boolean;
  busy: boolean;
  onLabel: (label: string | null) => Promise<void>;
  onRestore: (versionId: string, modifiedMs: number) => void;
  onArchive: () => void;
}) {
  const t = getT();
  const locale = getLocaleCode();
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const slot = entry.kind === 'state' ? `#${entry.slot && /^\d+$/.test(entry.slot) ? entry.slot : '1'}` : null;
  return (
    <li className="game-saves-row">
      <time className="game-saves-date" dateTime={new Date(entry.modifiedMs).toISOString()} title={formatAbsoluteTime(entry.modifiedMs, locale)}>
        {formatRelativeTime(entry.modifiedMs, now, locale)}
      </time>
      <div className="game-saves-thumb" aria-hidden="true">
        {entry.thumbnail
          ? <img className="cover-image-fill" src={entry.thumbnail} alt="" loading="lazy" decoding="async" />
          : entry.kind === 'battery' ? <IconBattery /> : <IconState />}
      </div>
      <div className="game-saves-main">
        <div className="game-saves-chips">
          {slot && <span className="game-saves-slot">{slot}</span>}
          {entry.shared && <span className="game-saves-chip">{t.saves.shared_card}</span>}
          {entry.isFolder && <span className="game-saves-chip">{t.saves.folder_save}</span>}
          <span className="game-saves-name" title={entry.name}>{entry.name}</span>
        </div>
        <SaveLabel entry={entry} onSave={onLabel} />
      </div>
      <div className="game-saves-actions">
        {driveSync && (
          <span
            className={`game-saves-sync${entry.synced ? ' game-saves-sync--ok' : ''}`}
            title={entry.synced ? t.saves.sync_synced : t.saves.sync_pending}
            aria-label={entry.synced ? t.saves.sync_synced : t.saves.sync_pending}
            role="img"
          >
            <IconCloud synced={entry.synced} />
          </span>
        )}
        {entry.versions.length > 0 && (
          <div className="game-saves-versions-control">
            {!selectedVersionId && <IconState />}
            <select
              className={`game-saves-versions${selectedVersionId ? '' : ' game-saves-versions--placeholder'}`}
              aria-label={t.saves.versions}
              title={t.saves.versions}
              value={selectedVersionId}
              disabled={busy}
              onChange={event => {
                const versionId = event.target.value;
                setSelectedVersionId(versionId);
                const version = entry.versions.find(candidate => candidate.id === versionId);
                if (version) onRestore(version.id, version.modifiedMs);
              }}
            >
              <option value="" hidden>{t.saves.versions}</option>
              {entry.versions.map(version => (
                <option key={version.id} value={version.id}>
                  {formatVersionDate(version.modifiedMs)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="game-saves-archive-group">
          <button type="button" className="game-saves-icon-btn" onClick={onArchive} disabled={busy} title={t.saves.archive} aria-label={t.saves.archive}>
            <IconArchive />
          </button>
          <span className="game-saves-size">{formatBytes(entry.size)}</span>
        </div>
      </div>
    </li>
  );
}

// Saves of an emulated game: battery saves and save states kept in the
// central saves folder (see docs/SAVES.md), with labels, previous versions,
// archive and the Google Drive sync state.
export function GameSavesSection({ platformId, romPath, title }: GameSavesSectionProps) {
  const t = getT();
  const [saves, setSaves] = useState<GameSaves | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [now, setNow] = useState(currentTime);
  const game = useMemo<SaveGameRef>(() => ({ platformId, romPath, title }), [platformId, romPath, title]);

  const load = useCallback(async () => {
    try {
      const next = await listGameSaves(game);
      setSaves(next);
      setNow(currentTime());
      setStatus(prev => (prev?.tone === 'error' ? null : prev));
    } catch (error) {
      setStatus({ text: `${t.saves.load_error}: ${formatAppError(error, t)}`, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [game, t]);

  // The parent keys this section by game, so a new game remounts it.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    onSavesChanged(() => { void load(); })
      .then(stop => { if (cancelled) stop(); else unlisten = stop; })
      .catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, [load]);

  const run = async (action: () => Promise<GameSaves | void>) => {
    setBusy(true);
    try {
      const result = await action();
      if (result) {
        setSaves(result);
        setNow(currentTime());
      }
    } catch (error) {
      setStatus({ text: formatAppError(error, t), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const locale = getLocaleCode();
  const onRestore = (entry: SaveEntry) => (versionId: string, modifiedMs: number) => {
    if (!window.confirm(interpolate(t.saves.restore_version_confirm, { date: formatAbsoluteTime(modifiedMs, locale) }))) return;
    void run(() => restoreSaveVersion(game, entry.id, versionId));
  };
  const onArchive = (entry: SaveEntry) => () => {
    if (!window.confirm(t.saves.archive_confirm)) return;
    void run(() => archiveSave(game, entry.id));
  };
  const onSync = () => {
    setStatus({ text: t.saves.syncing, tone: 'info' });
    void run(async () => {
      const report = await syncSavesNow(game);
      const parts = [interpolate(t.saves.sync_done, { up: report.uploaded, down: report.downloaded })];
      if (report.conflicts > 0) parts.push(interpolate(t.saves.sync_conflicts, { n: report.conflicts }));
      setStatus({ text: parts.join(' · '), tone: 'info' });
      return listGameSaves(game);
    });
  };

  const entries = saves?.entries ?? [];
  const { battery, states } = groupSaves(entries);
  const emulator = saves?.emulator ?? '';

  const renderRows = (list: SaveEntry[]) => (
    <ul className="game-saves-list">
      {list.map(entry => (
        <SaveRow
          key={entry.id}
          entry={entry}
          now={now}
          driveSync={!!saves?.driveSync}
          busy={busy}
          onLabel={label => run(() => setSaveLabel(game, entry.id, label))}
          onRestore={onRestore(entry)}
          onArchive={onArchive(entry)}
        />
      ))}
    </ul>
  );

  let body: React.ReactNode;
  if (loading && !saves) {
    body = <p className="local-steam-screenshots-empty">{t.saves.loading}</p>;
  } else if (entries.length > 0) {
    body = (
      <div className="game-saves-groups">
        <div className="game-saves-group">
          <h4 className="game-saves-group-title">{t.saves.kind_battery} (.sav)</h4>
          {battery.length > 0 ? renderRows(battery) : <p className="game-saves-group-empty">—</p>}
        </div>
        <div className="game-saves-group">
          <h4 className="game-saves-group-title">{t.saves.kind_state} (.ml1)</h4>
          {states.length > 0 ? renderRows(states) : <p className="game-saves-group-empty">—</p>}
        </div>
      </div>
    );
  } else if (saves && !saves.emulator) {
    body = <p className="local-steam-screenshots-empty">{t.saves.empty_no_emulator}</p>;
  } else if (saves?.strategy === 'unsupported') {
    body = <p className="local-steam-screenshots-empty">{interpolate(t.saves.empty_unsupported, { emulator })}</p>;
  } else if (saves) {
    body = (
      <div className="game-saves-empty">
        <p className="game-saves-empty-title">{t.saves.empty_title}</p>
        <p className="game-saves-hint">{interpolate(t.saves.empty_body, { path: saves.folder ?? saves.root })}</p>
      </div>
    );
  }

  return (
    <section className="game-saves" aria-label={t.saves.section_title}>
      <div className="game-saves-toolbar">
        {saves?.driveSync && (
          <button type="button" className="game-saves-text-btn" onClick={onSync} disabled={busy}>
            <IconCloud synced />
            <span>{t.saves.sync_now}</span>
          </button>
        )}
        <button type="button" className="game-saves-icon-btn" onClick={() => { void run(() => openSavesFolder(game)); }} title={t.saves.open_folder} aria-label={t.saves.open_folder}>
          <IconFolder />
        </button>
        <button type="button" className="game-saves-icon-btn" onClick={() => { void load(); }} disabled={busy} title={t.saves.refresh} aria-label={t.saves.refresh}>
          <IconRefresh />
        </button>
      </div>
      {body}
      {status && (
        <p className={`game-saves-status${status.tone === 'error' ? ' game-saves-status--error' : ''}`} role={status.tone === 'error' ? 'alert' : 'status'}>
          {status.text}
        </p>
      )}
    </section>
  );
}
