import { useState, useEffect, useCallback, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryEntry } from '../../lib/tauri';
import { saveLibraryEntry, getLibraryEntry, deleteLibraryEntry } from '../../lib/tauri';
import type { MediaPageData } from '../../lib/media/types';

interface Props {
  externalId: string;
  data: MediaPageData;
  onClose: () => void;
  onSaved: (entry: LibraryEntry) => void;
  onDeleted: () => void;
}

const STAR_PATH =
  'M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 2l3.086 6.253 6.9 1.002-4.993 4.867 1.179 6.873z';

function progressLabel(type: string): string | null {
  switch (type) {
    case 'game':         return 'Horas jugadas';
    case 'vnovel':       return 'Horas jugadas';
    case 'anime':        return 'Episodios vistos';
    case 'series':       return 'Episodios vistos';
    case 'manga':        return 'Capítulos leídos';
    case 'light-novel':  return 'Capítulos leídos';
    case 'books':        return '% completado';
    case 'movies':       return null;
    default:             return 'Progreso';
  }
}

function progressStep(type: string): number {
  return type === 'game' || type === 'vnovel' ? 0.5 : 1;
}

export function MediaEditorModal({ externalId, data, onClose, onSaved, onDeleted }: Props) {
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [existing,  setExisting]  = useState<LibraryEntry | null>(null);

  // Form state
  const [status,    setStatus]    = useState('planning');
  const [rating,    setRating]    = useState(0);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [progress,  setProgress]  = useState(0);
  const [notes,     setNotes]     = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [finishedAt,setFinishedAt]= useState('');
  const [isFavorite,setIsFavorite]= useState(false);
  const [isPlatinum,setIsPlatinum]= useState(false);
  const [tags,      setTags]      = useState<string[]>([]);
  const [tagInput,  setTagInput]  = useState('');
  const [platform,  setPlatform]  = useState('');

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
  }, [externalId, data.type]);

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
      onSaved(entry);
      onClose();
    } catch (e) {
      console.error('save_library_entry error', e);
    } finally {
      setSaving(false);
    }
  }, [existing, externalId, data.type, status, rating, progress, notes,
      startedAt, finishedAt, isFavorite, isPlatinum, tags, platform, onSaved, onClose]);

  const handleDelete = useCallback(async () => {
    if (!existing) { onClose(); return; }
    try {
      await deleteLibraryEntry(externalId, data.type);
      onDeleted();
    } catch (e) {
      console.error('delete_library_entry error', e);
    }
    onClose();
  }, [existing, externalId, data.type, onDeleted, onClose]);

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
  };

  const statusButtons = [
    { value: 'planning',            label: 'Pendiente' },
    { value: data.progressStatus,   label: data.progressLabel },
    { value: 'completed',           label: 'Terminado' },
    { value: 'paused',              label: 'En pausa' },
    { value: 'dropped',             label: 'Abandonado' },
  ];

  const displayRating = hoverRating ?? rating;
  const progLabel = progressLabel(data.type);

  const modal = (
    <div className="me-overlay" onClick={onClose}>
      <div className="me-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="me-header">
          <div className="me-header-info">
            {data.cover && (
              <img src={data.cover} alt="" className="me-header-cover" />
            )}
            <span className="me-header-title">{data.titleMain}</span>
          </div>
          <button type="button" className="me-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="me-loading"><div className="spinner" /></div>
        ) : (
          <div className="me-body">

            {/* Status */}
            <div className="me-section">
              <span className="me-label">Estado</span>
              <div className="me-status-row">
                {statusButtons.map(btn => (
                  <button
                    key={btn.value}
                    type="button"
                    className={`me-status-btn me-status-btn--${btn.value}${status === btn.value ? ' active' : ''}`}
                    onClick={() => setStatus(status === btn.value ? '' : btn.value)}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Rating */}
            <div className="me-section">
              <span className="me-label">
                Puntuación
                {rating > 0 && <span className="me-label-value">{(rating / 2).toFixed(1)}</span>}
              </span>
              <div className="me-stars" onMouseLeave={() => setHoverRating(null)}>
                {[1, 2, 3, 4, 5].map(v => {
                  const isFull = displayRating >= v * 2;
                  const isHalf = !isFull && displayRating >= v * 2 - 1;
                  return (
                    <div key={v} className="me-star-wrap">
                      <svg className="me-star me-star--bg" viewBox="0 0 24 24">
                        <path d={STAR_PATH} />
                      </svg>
                      <div
                        className="me-star-fill"
                        style={{ width: isFull ? '100%' : isHalf ? '50%' : '0%' }}
                      >
                        <svg className="me-star me-star--fg" viewBox="0 0 24 24">
                          <path d={STAR_PATH} />
                        </svg>
                      </div>
                      <button
                        type="button"
                        className="me-star-zone me-star-zone--left"
                        onMouseEnter={() => setHoverRating(v * 2 - 1)}
                        onClick={() => setRating(rating === v * 2 - 1 ? 0 : v * 2 - 1)}
                      />
                      <button
                        type="button"
                        className="me-star-zone me-star-zone--right"
                        onMouseEnter={() => setHoverRating(v * 2)}
                        onClick={() => setRating(rating === v * 2 ? 0 : v * 2)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Progress + Dates */}
            <div className="me-row">
              {progLabel && (
                <div className="me-section me-section--col">
                  <span className="me-label">{progLabel}</span>
                  <input
                    type="number"
                    className="me-input"
                    min={0}
                    step={progressStep(data.type)}
                    value={progress || ''}
                    onChange={e => setProgress(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>
              )}
              <div className="me-section me-section--col">
                <span className="me-label">Fecha inicio</span>
                <input
                  type="date"
                  className="me-input"
                  value={startedAt}
                  onChange={e => setStartedAt(e.target.value)}
                />
              </div>
              <div className="me-section me-section--col">
                <span className="me-label">Fecha fin</span>
                <input
                  type="date"
                  className="me-input"
                  value={finishedAt}
                  onChange={e => setFinishedAt(e.target.value)}
                />
              </div>
            </div>

            {/* Tags */}
            <div className="me-section">
              <span className="me-label">
                Etiquetas
                <span className="me-label-hint">{tags.length}/5</span>
              </span>
              <div className="me-tags-box">
                {tags.map(tag => (
                  <span key={tag} className="me-tag">
                    {tag}
                    <button
                      type="button"
                      className="me-tag-remove"
                      onClick={() => setTags(prev => prev.filter(t => t !== tag))}
                    >×</button>
                  </span>
                ))}
                {tags.length < 5 && (
                  <input
                    type="text"
                    className="me-tag-input"
                    placeholder="Añadir etiqueta…"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                  />
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="me-section">
              <span className="me-label">Notas</span>
              <textarea
                className="me-textarea"
                placeholder="Tu reseña o notas personales…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            {/* Toggles row */}
            <div className="me-toggles-row">
              <button
                type="button"
                className={`me-toggle${isFavorite ? ' active' : ''}`}
                onClick={() => setIsFavorite(p => !p)}
                title="Favorito"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                Favorito
              </button>
              <button
                type="button"
                className={`me-toggle${isPlatinum ? ' active' : ''}`}
                onClick={() => setIsPlatinum(p => !p)}
                title="Platino"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={isPlatinum ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
                </svg>
                Platino
              </button>
            </div>

            {/* Actions */}
            <div className="me-actions">
              {existing && (
                <button
                  type="button"
                  className="me-btn me-btn--delete"
                  onClick={handleDelete}
                  disabled={saving}
                >
                  Eliminar
                </button>
              )}
              <button
                type="button"
                className="me-btn me-btn--save"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
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
