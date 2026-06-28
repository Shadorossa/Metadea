import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntry } from '../../lib/tauri';
import { saveLibraryEntry, getLibraryEntry, deleteLibraryEntry, readMonthlyHistory, writeMonthlyHistory, readUserFavorites, writeUserFavorites } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';
import { es } from '../../i18n/es';
import { en } from '../../i18n/en';

interface Props {
  externalId: string;
  data: MediaPageData;
  lang: string;
  onClose: () => void;
  onSaved: (entry: LibraryEntry) => void;
  onDeleted: () => void;
}

const STAR_PATH =
  'M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z';

// ── Status icons ──────────────────────────────────────────────────────────────
const IconPlanning = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);
const IconInProgress = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon fill="currentColor" stroke="none" points="10,8 16,12 10,16" />
  </svg>
);
const IconCompleted = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);
const IconPaused = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="10" y1="15" x2="10" y2="9" />
    <line x1="14" y1="15" x2="14" y2="9" />
  </svg>
);
const IconDropped = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

function progressLabel(type: string, te: typeof es.media): string | null {
  switch (type) {
    case 'game':
    case 'vnovel':       return te.progress_hours;
    case 'anime':
    case 'series':       return te.progress_episodes;
    case 'manga':
    case 'light-novel':  return te.progress_chapters;
    case 'books':        return te.progress_percent;
    case 'movies':       return null;
    default:             return te.editor.progress;
  }
}

function progressStep(type: string): number {
  return type === 'game' || type === 'vnovel' ? 0.5 : 1;
}

export function MediaEditorModal({ externalId, data, lang, onClose, onSaved, onDeleted }: Props) {
  const t  = lang === 'en' ? en : es;
  const te = t.media.editor;

  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [isClosing,   setIsClosing]   = useState(false);
  const [existing,    setExisting]    = useState<LibraryEntry | null>(null);
  const [status,      setStatus]      = useState('planning');
  const [rating,      setRating]      = useState(0);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [progress,    setProgress]    = useState(0);
  const [notes,       setNotes]       = useState('');
  const [startedAt,   setStartedAt]   = useState('');
  const [finishedAt,  setFinishedAt]  = useState('');
  const [isFavorite,  setIsFavorite]  = useState(false);
  const [isPlatinum,  setIsPlatinum]  = useState(false);
  const [tags,        setTags]        = useState<string[]>([]);
  const [tagInput,    setTagInput]    = useState('');
  const [platform,    setPlatform]    = useState('');

  const [monthlyHistory, setMonthlyHistory] = useState<Record<string, string[]>>({});
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    getLibraryEntry(externalId, data.type)
      .then(entry => {
        if (entry) {
          setExisting(entry);
          setStatus(entry.status ?? 'planning');
          setRating(entry.rating ?? 0);
          setProgress(entry.progress ?? 0);
          setNotes(entry.notes ?? '');
          setStartedAt(entry.started_at ?? '');
          setFinishedAt(entry.finished_at ?? '');
          setIsFavorite(entry.is_favorite === 1);
          setIsPlatinum(entry.is_platinum === 1);
          setTags(entry.tags ?? []);
          setPlatform(entry.selected_platform ?? '');
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    readMonthlyHistory()
      .then(history => {
        setMonthlyHistory(history);
        let foundKey: string | null = null;
        for (const [key, ids] of Object.entries(history)) {
          if (ids.includes(externalId)) {
            foundKey = key;
            break;
          }
        }
        setSelectedMonthKey(foundKey);
        if (foundKey) {
          const parts = foundKey.split('-');
          if (parts.length === 2) {
            setSelectedYear(Number(parts[0]));
          }
        }
      })
      .catch(() => {});
  }, [externalId, data.type]);

  const handleMonthClick = useCallback((monthIndex: number) => {
    const targetKey = `${selectedYear}-${String(monthIndex).padStart(2, '0')}`;

    setSelectedMonthKey(prev => {
      const newKey = prev === targetKey ? null : targetKey;

      setMonthlyHistory(currentHistory => {
        const nextHistory = { ...currentHistory };

        for (const key of Object.keys(nextHistory)) {
          nextHistory[key] = nextHistory[key].filter(id => id !== externalId);
        }

        if (newKey) {
          if (!nextHistory[newKey]) nextHistory[newKey] = [];
          if (!nextHistory[newKey].includes(externalId)) {
            nextHistory[newKey].push(externalId);
          }
        }

        for (const key of Object.keys(nextHistory)) {
          if (nextHistory[key].length === 0) {
            delete nextHistory[key];
          }
        }

        return nextHistory;
      });

      return newKey;
    });
  }, [externalId, selectedYear]);

  const handlePrevYear = useCallback(() => {
    setSelectedYear(y => y - 1);
  }, []);

  const handleNextYear = useCallback(() => {
    setSelectedYear(y => y + 1);
  }, []);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, 180);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const entry = await saveLibraryEntry({
        id:               existing?.id ?? '',
        user_id:          'local',
        external_id:      externalId,
        type:             data.type,
        status:           status || null,
        rating:           rating > 0 ? rating : null,
        progress,
        minutes_spent:    data.type === 'game' || data.type === 'vnovel'
                            ? progress * 60
                            : (existing?.minutes_spent ?? 0),
        is_favorite:      isFavorite ? 1 : 0,
        is_platinum:      isPlatinum ? 1 : 0,
        tags:             tags.length > 0 ? tags : null,
        notes:            notes.trim() || null,
        added_at:         existing?.added_at ?? null,
        updated_at:       null,
        selected_platform: platform || null,
        selected_version:  existing?.selected_version ?? null,
        started_at:       startedAt || null,
        finished_at:      finishedAt || null,
      });

      await writeMonthlyHistory(monthlyHistory);

      /* ── Sync with user_favorite.json ───────────────────────────────────────── */
      try {
        const favs = await readUserFavorites().catch(() => ({} as Record<string, string[]>));
        const type = data.type || 'book';
        if (!favs[type]) favs[type] = [];
        
        if (isFavorite) {
          if (!favs[type].includes(externalId)) {
            favs[type].push(externalId);
          }
        } else {
          favs[type] = favs[type].filter(id => id !== externalId);
          if (favs.multimedia) {
            favs.multimedia = favs.multimedia.filter(id => id !== externalId);
          }
        }
        await writeUserFavorites(favs);
      } catch (e) {
        console.error('Failed to sync favorites JSON', e);
      }

      onSaved(entry);
      handleClose();
    } catch (e) {
      console.error('save_library_entry error', e);
    } finally {
      setSaving(false);
    }
  }, [existing, externalId, data.type, status, rating, progress, notes,
      startedAt, finishedAt, isFavorite, isPlatinum, tags, platform, monthlyHistory, onSaved, handleClose]);

  const handleDelete = useCallback(async () => {
    if (!existing) { onClose(); return; }
    try {
      await deleteLibraryEntry(externalId, data.type);

      /* ── Sync with user_favorite.json upon delete ──────────────────────────── */
      try {
        const favs = await readUserFavorites().catch(() => ({} as Record<string, string[]>));
        const type = data.type || 'book';
        if (favs[type]) {
          favs[type] = favs[type].filter(id => id !== externalId);
        }
        if (favs.multimedia) {
          favs.multimedia = favs.multimedia.filter(id => id !== externalId);
        }
        await writeUserFavorites(favs);
      } catch (e) {
        console.error('Failed to delete from favorites JSON', e);
      }

      onDeleted();
    } catch (e) {
      console.error('delete_library_entry error', e);
    }
    onClose();
  }, [existing, externalId, data.type, onDeleted, onClose]);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = tagInput.trim();
      if (tag && tags.length < 5 && !tags.includes(tag)) {
        setTags(prev => [...prev, tag]);
        setTagInput('');
      }
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(prev => prev.slice(0, -1));
    }
  }, [tagInput, tags]);

  const statusButtons = useMemo(() => [
    { value: 'planning',          label: te.status_planning,    Icon: IconPlanning    },
    { value: data.progressStatus, label: te.status_in_progress, Icon: IconInProgress  },
    { value: 'completed',         label: te.status_completed,   Icon: IconCompleted   },
    { value: 'paused',            label: te.status_paused,      Icon: IconPaused      },
    { value: 'dropped',           label: te.status_dropped,     Icon: IconDropped     },
  ], [te, data.progressStatus]);

  const displayRating = hoverRating ?? rating;
  const progLabel     = progressLabel(data.type, t.media);

  const modal = (
    <div className={`me-overlay${isClosing ? ' me-overlay--out' : ''}`} onClick={handleClose}>
      <div className="me-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="me-header">
          <div className="me-header-left">
            {data.cover && <img src={data.cover} alt="" className="me-header-cover" />}
            <div className="me-header-col">
              <span className="me-header-title">{data.titleMain}</span>
              {/* Status icons + Progress + Rating + Dates row */}
              <div className="me-header-bottom-row">
                <div className="me-header-status-row">
                  {statusButtons.map(({ value, label, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      className={`me-header-status-icon${status === value ? ' active' : ''}`}
                      onClick={() => setStatus(status === value ? '' : value)}
                      title={label}
                    >
                      <Icon />
                    </button>
                  ))}
                </div>

                {/* Progress input */}
                {progLabel && (() => {
                  const maxVal = data.totalCount && data.totalCount > 0 ? data.totalCount : undefined;
                  return (
                    <div className="me-header-field">
                      <label className="me-header-field-label">{progLabel}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input type="number" className="me-header-field-input" min={0}
                          max={maxVal}
                          step={progressStep(data.type)}
                          value={progress || ''}
                          onChange={e => {
                            let val = parseFloat(e.target.value) || 0;
                            if (maxVal !== undefined && val > maxVal) val = maxVal;
                            setProgress(val);
                          }}
                          placeholder="0"
                          style={{ width: '60px' }} />
                        {maxVal !== undefined && (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>/ {maxVal}</span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Rating stars */}
                <div className="me-header-field">
                  <label className="me-header-field-label">{te.score}</label>
                  <div className="me-header-stars" onMouseLeave={() => setHoverRating(null)}>
                    {[1, 2, 3, 4, 5].map(v => {
                      const isFull = displayRating >= v * 2;
                      const isHalf = !isFull && displayRating >= v * 2 - 1;
                      return (
                        <div key={v} className="me-header-star-wrap">
                          <svg className="me-header-star me-header-star--bg" viewBox="0 0 24 24">
                            <path d={STAR_PATH} />
                          </svg>
                          <div className="me-header-star-fill" style={{ width: isFull ? '100%' : isHalf ? '50%' : '0%' }}>
                            <svg className="me-header-star me-header-star--fg" viewBox="0 0 24 24">
                              <path d={STAR_PATH} />
                            </svg>
                          </div>
                          <button type="button" className="me-header-star-zone me-header-star-zone--left"
                            onMouseEnter={() => setHoverRating(v * 2 - 1)}
                            onClick={() => setRating(rating === v * 2 - 1 ? 0 : v * 2 - 1)} />
                          <button type="button" className="me-header-star-zone me-header-star-zone--right"
                            onMouseEnter={() => setHoverRating(v * 2)}
                            onClick={() => setRating(rating === v * 2 ? 0 : v * 2)} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Start date */}
                <div className="me-header-field">
                  <label className="me-header-field-label">{te.started}</label>
                  <input type="date" className="me-header-field-input me-header-field-input--date"
                    value={startedAt}
                    onChange={e => setStartedAt(e.target.value)} />
                </div>

                {/* End date */}
                <div className="me-header-field">
                  <label className="me-header-field-label">{te.ended}</label>
                  <input type="date" className="me-header-field-input me-header-field-input--date"
                    value={finishedAt}
                    onChange={e => setFinishedAt(e.target.value)} />
                </div>
              </div>
            </div>
          </div>
          <div className="me-header-right">
            <button
              type="button"
              className={`me-header-icon-btn${isFavorite ? ' active' : ''}`}
              onClick={() => setIsFavorite(p => !p)}
              title={te.favorite}
            >
              <svg width="18" height="18" viewBox="0 0 24 24"
                fill={isFavorite ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth="1.8">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
            <button
              type="button"
              className={`me-header-icon-btn${isPlatinum ? ' active' : ''}`}
              onClick={() => setIsPlatinum(p => !p)}
              title={te.platinum}
            >
              <svg width="18" height="18" viewBox="0 0 24 24"
                fill={isPlatinum ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="me-loading"><div className="spinner" /></div>
        ) : (
          <div className="me-body">
            <div className="me-content-wrapper">
              {/* MAIN CONTENT */}
              <div className="me-main-box">
                <div className="me-grid">

                  {/* LEFT: Tags */}
                  <div className="me-col">
                    {/* Tags */}
                    <div className="me-section">
                      <span className="me-label">
                        {te.tags}
                        <span className="me-label-hint">{tags.length}/5</span>
                      </span>
                      <div className="me-tags-box">
                        {tags.map(tag => (
                          <span key={tag} className="me-tag">
                            {tag}
                            <button type="button" className="me-tag-remove"
                              onClick={() => setTags(prev => prev.filter(t => t !== tag))}>×</button>
                          </span>
                        ))}
                        {tags.length < 5 && (
                          <input type="text" className="me-tag-input"
                            placeholder={te.add_tag}
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={handleTagKeyDown} />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* LEFT: Notes box (separate) */}
              <div className="me-notes-box-side">
                <span className="me-label">{te.notes}</span>
                <textarea className="me-textarea" rows={12}
                  placeholder={te.notes_ph}
                  value={notes}
                  onChange={e => setNotes(e.target.value)} />

                <div className="me-month-selector-section">
                  <div className="me-month-header">
                    <span className="me-label">{lang === 'en' ? 'History Month' : 'Mes de Historial'}</span>
                    <div className="me-year-selector">
                      <button type="button" className="me-year-arrow" onClick={handlePrevYear}>&lt;</button>
                      <span className="me-year-val">{selectedYear}</span>
                      <button type="button" className="me-year-arrow" onClick={handleNextYear}>&gt;</button>
                    </div>
                  </div>
                  <div className="me-month-grid">
                    {te.months.map((mName, idx) => {
                      const mNumber = idx + 1;
                      const key = `${selectedYear}-${String(mNumber).padStart(2, '0')}`;
                      const isActive = selectedMonthKey === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`me-month-btn${isActive ? ' active' : ''}`}
                          onClick={() => handleMonthClick(mNumber)}
                        >
                          {mName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* RIGHT: Buttons stack (separate) */}
              <div className="me-button-stack-side">
                <button type="button" className="me-btn me-btn--save"
                  onClick={handleSave} disabled={saving}>
                  {saving ? te.saving : te.save}
                </button>
                <button type="button" className="me-btn me-btn--close"
                  onClick={handleClose}>✕</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modal, document.body)
    : null;
}
