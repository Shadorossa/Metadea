import { useEffect, useMemo, useRef, useState } from 'react';
import { ModalShell } from '../../shared/ModalShell';
import { MediaSourceMappingSearchPopup } from '../../search-popups/MediaSourceMappingSearchPopup';
import { comicVineStoryArcsForVolume } from '../../../lib/tauri/comicvine';
import { saveStoryArc } from '../../../lib/tauri/story-arcs';
import { suggestComicVineVolume, type ComicVineVolumeSuggestion } from '../../../lib/media/editions/comic-issues';
import {
  arcChoiceToStoryArc, arcNameExists, buildArcCandidates, defaultImportRange, needsReview,
  type ArcImportUnit, type ComicVineArcCandidate, type Range,
} from '../../../lib/media/story-arcs/comicvine-arc-import';
import { formatAppError } from '../../../lib/errors/format-error';
import { interpolate } from '../../../lib/shared/text/interpolate';
import type { SearchResult } from '../../../lib/search';
import { getT } from '../../../i18n/runtime';

interface Props {
  externalId: string;
  currentTitle: string;
  unit: ArcImportUnit;
  existingArcNames: string[];
  onImported: () => void | Promise<void>;
  onClose: () => void;
}

interface RowState {
  selected: boolean;
  start: string;
  end: string;
  useImage: boolean;
}

type VolumeSource = ComicVineVolumeSuggestion['source'] | 'picked';

const toInput = (value: number | undefined) => (value == null ? '' : String(value));
const parseInput = (value: string) => (value.trim() === '' ? null : Number(value));

// "Import from ComicVine" for the story-arc editor: pick the work's ComicVine
// volume (pre-selected like the Issues tab resolves it), list that volume's
// story arcs with their chapter (manga) or issue (comic) ranges, and add the
// checked ones as ordinary arcs of this work. They land in the local arc
// table exactly like hand-made arcs, so they only reach the community
// catalog through the normal proposal submit.
export function PrEditorComicVineArcImport({ externalId, currentTitle, unit, existingArcNames, onImported, onClose }: Props) {
  const t = getT().pr_editor.story_arcs;
  const [volumeId, setVolumeId] = useState<number | null>(null);
  const [volumeSource, setVolumeSource] = useState<VolumeSource | null>(null);
  const [volumeName, setVolumeName] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ComicVineArcCandidate[]>([]);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVolumePicker, setShowVolumePicker] = useState(false);
  const [adding, setAdding] = useState(false);
  const loadRequest = useRef(0);

  async function loadArcs(id: number, refresh = false) {
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const data = await comicVineStoryArcsForVolume(id, refresh);
      if (request !== loadRequest.current) return;
      const built = buildArcCandidates(data, unit);
      setCandidates(built);
      setComplete(data.complete);
      setVolumeName(prev => data.issues.find(issue => issue.volume?.name)?.volume?.name ?? prev);
      setRows(Object.fromEntries(built.map(candidate => {
        const range = defaultImportRange(candidate, unit);
        return [candidate.id, {
          selected: !arcNameExists(candidate.name, existingArcNames),
          start: toInput(range?.[0]),
          end: toInput(range?.[1]),
          useImage: candidate.image != null,
        }];
      })));
    } catch (err) {
      if (request !== loadRequest.current) return;
      setCandidates([]);
      setError(formatAppError(err, getT()));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    suggestComicVineVolume(externalId, currentTitle)
      .then(suggestion => {
        if (cancelled) return;
        setVolumeSource(suggestion.source);
        setVolumeId(suggestion.volumeId);
        if (suggestion.volumeId) loadArcs(suggestion.volumeId);
        else setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setVolumeSource('unavailable');
        setError(formatAppError(err, getT()));
        setLoading(false);
      });
    return () => { cancelled = true; };
    // Runs once per opened modal; loadArcs only reads props fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalId]);

  function pickVolume(result: SearchResult) {
    const id = Number(result.externalId.split(':').pop());
    if (!Number.isInteger(id) || id <= 0) return;
    setVolumeId(id);
    setVolumeSource('picked');
    setVolumeName(result.titleMain);
    loadArcs(id);
  }

  const patchRow = (id: number, patch: Partial<RowState>) => setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const nameById = useMemo(() => new Map(candidates.map(c => [c.id, c.name])), [candidates]);
  const selected = candidates.filter(candidate => rows[candidate.id]?.selected);

  async function addSelected() {
    if (selected.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      for (const candidate of selected) {
        const row = rows[candidate.id];
        await saveStoryArc(arcChoiceToStoryArc({ candidate, start: parseInput(row.start), end: parseInput(row.end), useImage: row.useImage }, externalId));
      }
      await onImported();
      onClose();
    } catch (err) {
      setError(formatAppError(err, getT()));
      await onImported();
    } finally {
      setAdding(false);
    }
  }

  const formatSpan = (range: Range | null, single: string, span: string) => {
    if (!range) return null;
    return range[0] === range[1]
      ? interpolate(single, { n: range[0] })
      : interpolate(span, { start: range[0], end: range[1] });
  };

  const volumeHint = volumeSource && ({
    'comic-id': t.cv_volume_comic,
    mapping: t.cv_volume_mapping,
    search: t.cv_volume_search,
    none: t.cv_volume_none,
    unavailable: t.cv_volume_unavailable,
    picked: null,
  } as Record<VolumeSource, string | null>)[volumeSource];

  function renderFlags(candidate: ComicVineArcCandidate) {
    const flags: string[] = [];
    if (unit === 'chapters' && candidate.chapterSegments.length > 1) flags.push(t.cv_flag_gaps);
    if (candidate.estimatedVolumes.length) flags.push(interpolate(t.cv_flag_estimated, { volumes: candidate.estimatedVolumes.join(', ') }));
    if (candidate.unresolvedVolumes.length) flags.push(interpolate(t.cv_flag_volumes_only, { volumes: candidate.unresolvedVolumes.join(', ') }));
    if (candidate.overlapsWith.length) flags.push(interpolate(t.cv_flag_overlap, { names: candidate.overlapsWith.map(id => nameById.get(id) ?? `#${id}`).join(', ') }));
    if (arcNameExists(candidate.name, existingArcNames)) flags.push(t.cv_flag_exists);
    if (flags.length === 0) return null;
    return (
      <ul className="pr-editor-cv-import-flags">
        {flags.map(flag => <li key={flag}>{flag}</li>)}
      </ul>
    );
  }

  return (
    <ModalShell
      onClose={onClose}
      label={t.cv_title}
      overlayClassName="pr-editor-search-popup"
      panelClassName="pr-editor-search-popup-content pr-editor-search-popup-content--wide pr-editor-cv-import"
      overlayChildren={showVolumePicker && (
        <MediaSourceMappingSearchPopup kind="issues" onSelect={pickVolume} onClose={() => setShowVolumePicker(false)} />
      )}
    >
      <div className="pr-editor-cv-import-header">
        <h3 className="pr-editor-cv-import-title">{t.cv_title}</h3>
        <button type="button" className="pr-editor-arc-card-delete" onClick={onClose} aria-label={t.cancel}>×</button>
      </div>

      <div className="pr-editor-cv-import-volume">
        <div className="pr-editor-cv-import-volume-info">
          <span className="pr-editor-cv-import-label">{t.cv_volume_label}</span>
          {volumeId != null && <span className="pr-editor-cv-import-volume-name">{volumeName || 'ComicVine'} · {volumeId}</span>}
          {volumeHint && <span className="pr-editor-cv-import-hint">{volumeHint}</span>}
        </div>
        <button type="button" className="pr-editor-add-btn" onClick={() => setShowVolumePicker(true)} disabled={adding}>
          {volumeId != null ? t.cv_change_volume : t.cv_pick_volume}
        </button>
      </div>

      {error && (
        <div className="pr-editor-cv-import-error" role="alert">
          <span>{error}</span>
          {volumeId != null && !loading && <button type="button" className="pr-editor-add-btn" onClick={() => loadArcs(volumeId)}>{t.cv_retry}</button>}
        </div>
      )}

      {loading && <div className="pr-editor-search-loading">{t.cv_loading}</div>}

      {!loading && !complete && (
        <div className="pr-editor-cv-import-warning">
          <span>{t.cv_partial}</span>
          {volumeId != null && <button type="button" className="pr-editor-add-btn" onClick={() => loadArcs(volumeId, true)}>{t.cv_rescan}</button>}
        </div>
      )}

      {!loading && !error && volumeId != null && candidates.length === 0 && (
        <div className="pr-editor-search-empty">{t.cv_empty}</div>
      )}

      {!loading && candidates.length > 0 && (
        <ul className="pr-editor-cv-import-list">
          {candidates.map(candidate => {
            const row = rows[candidate.id];
            if (!row) return null;
            const review = needsReview(candidate, unit);
            const mainRange = unit === 'chapters'
              ? formatSpan(candidate.chapterRange, t.cv_chapter_single, t.cv_chapter_range)
              : formatSpan(candidate.volumeRange, t.cv_issue_single, t.cv_issue_range);
            const volumes = unit === 'chapters' ? formatSpan(candidate.volumeRange, t.cv_volume_single, t.cv_volume_range) : null;
            return (
              <li key={candidate.id} className={`pr-editor-cv-import-row${row.selected ? ' is-selected' : ''}`}>
                <input
                  type="checkbox"
                  className="pr-editor-cv-import-check"
                  checked={row.selected}
                  onChange={e => patchRow(candidate.id, { selected: e.target.checked })}
                  aria-label={candidate.name}
                />
                <div className="pr-editor-arc-card-cover">
                  {candidate.image
                    ? <img src={candidate.image} alt="" loading="lazy" />
                    : <div className="pr-editor-media-card-placeholder" />}
                </div>
                <div className="pr-editor-cv-import-info">
                  <div className="pr-editor-cv-import-name">
                    {candidate.name}
                    {review && <span className="pr-editor-cv-import-review">{t.cv_review}</span>}
                  </div>
                  <div className="pr-editor-cv-import-ranges">
                    {mainRange && <span>{mainRange}</span>}
                    {volumes && <span>{volumes}</span>}
                  </div>
                  {candidate.description && <p className="pr-editor-cv-import-description">{candidate.description}</p>}
                  {renderFlags(candidate)}
                </div>
                <div className="pr-editor-cv-import-controls">
                  <label>
                    <span>{t.cv_start}</span>
                    <input type="number" min={1} value={row.start} onChange={e => patchRow(candidate.id, { start: e.target.value })} />
                  </label>
                  <label>
                    <span>{t.cv_end}</span>
                    <input type="number" min={1} value={row.end} onChange={e => patchRow(candidate.id, { end: e.target.value })} />
                  </label>
                  {candidate.image && (
                    <label className="pr-editor-cv-import-image-toggle">
                      <input type="checkbox" checked={row.useImage} onChange={e => patchRow(candidate.id, { useImage: e.target.checked })} />
                      <span>{t.cv_use_image}</span>
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="pr-editor-cv-import-footer">
        <div className="pr-editor-cv-import-footnotes">
          <span>{t.cv_note}</span>
          <span className="pr-editor-cv-import-attribution">{t.cv_attribution}</span>
        </div>
        <div className="pr-editor-cv-import-actions">
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={onClose} disabled={adding}>{t.cancel}</button>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={addSelected} disabled={adding || loading || selected.length === 0}>
            {adding ? t.cv_adding : interpolate(t.cv_add_selected, { count: selected.length })}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
