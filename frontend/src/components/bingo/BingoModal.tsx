// Yearly Bingo modal (opened from Home): edits the board inside its window
// (Dec 20 – Jan 10, lib/bingo/bingo-calendar.ts; yearly_bingo.rs enforces
// it with E_BINGO_LOCKED), otherwise shows it read-only — with its result
// from Dec 19 of the board's year. Works are picked with the app's shared
// multi-type MediaSearchPopup; each cell stores a snapshot of the work. The
// board's size (1–49 works, default 16) is chosen here while editable:
// growing appends empty cells, shrinking drops the trailing ones (after a
// confirmation when that loses picked works).
import { useId, useMemo, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { ModalShell } from '../shared/ModalShell';
import { MediaSearchPopup } from '../search-popups/MediaSearchPopup';
import type { SearchResult } from '../../lib/search';
import { setYearlyBingo, type BingoCell } from '../../lib/tauri/yearly-bingo';
import { bingoLockDate, isBingoEditable, isBingoResultPhase } from '../../lib/bingo/bingo-calendar';
import {
  DEFAULT_BINGO_SIZE, MAX_BINGO_SIZE, MIN_BINGO_SIZE, bingoCellsLostOnResize, resizeBingoCells,
} from '../../lib/bingo/bingo-grid';
import { computeBingoResult, moveBingoCell, type BingoLibraryRow } from '../../lib/bingo/bingo-result';
import { getActiveRatingSystem } from '../../lib/media/rating-utils';
import { formatDateLong } from '../../lib/shared/text/format-date';
import { interpolate } from '../../lib/shared/text/interpolate';
import { showToast } from '../../lib/dom/toast';
import { formatAppError } from '../../lib/errors/format-error';
import { BingoBoard, type BingoSlot } from './BingoBoard';
import { BingoSummary } from './BingoSummary';
import { BingoShareButton } from './BingoShareButton';

interface Props {
  year: number;
  /** The saved board (its length is its size), or null for a new one. */
  cells: BingoCell[] | null;
  library: readonly BingoLibraryRow[];
  now: Date;
  onClose: () => void;
  /** After a successful save, with the stored cells. */
  onSaved: (cells: BingoCell[]) => void;
}

// Keys for empty cells only need to be unique within the open board.
let emptyKeySeq = 0;
const nextEmptyKey = () => `empty-${emptyKeySeq++}`;

const emptySlot = (): BingoSlot => ({ key: nextEmptyKey(), item: null });
const SIZE_OPTIONS = Array.from({ length: MAX_BINGO_SIZE - MIN_BINGO_SIZE + 1 }, (_, i) => MIN_BINGO_SIZE + i);

function toSlots(cells: readonly BingoCell[] | null): BingoSlot[] {
  if (!cells || cells.length === 0) return Array.from({ length: DEFAULT_BINGO_SIZE }, emptySlot);
  return cells.map(item => (item ? { key: item.external_id, item } : emptySlot()));
}

function toCell(result: SearchResult): BingoCell {
  return {
    external_id: result.externalId,
    title: result.titleMain || result.externalId,
    cover_url: result.coverUrl ?? null,
    media_type: result.type,
  };
}

export function BingoModal({ year, cells, library, now, onClose, onSaved }: Props) {
  const b = getT().bingo;
  const [slots, setSlots] = useState<BingoSlot[]>(() => toSlots(cells));
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const sizeId = useId();
  const editable = isBingoEditable(year, now);
  const resultPhase = isBingoResultPhase(year, now);
  const ratingSystem = useMemo(() => getActiveRatingSystem(), []);
  const items = slots.map(s => s.item);
  const result = resultPhase ? computeBingoResult(items, library, year) : null;
  const filled = items.filter(Boolean).length;
  const title = interpolate(b.title, { year });
  const lockDate = formatDateLong(bingoLockDate(year));

  const update = (next: BingoSlot[]) => { setSlots(next); setDirty(true); };
  const pick = (picked: SearchResult) => {
    if (pickFor === null) return;
    const cell = toCell(picked);
    update(slots.map((slot, i) => (i === pickFor ? { key: picked.externalId, item: cell } : slot)));
    setPickFor(null);
  };
  const remove = (index: number) => update(slots.map((slot, i) => (i === index ? emptySlot() : slot)));
  const reorder = (from: number, to: number) => update(moveBingoCell(slots, from, to));
  const resize = (size: number) => {
    if (size === slots.length) return;
    const lost = bingoCellsLostOnResize(items, size);
    if (lost > 0 && !window.confirm(interpolate(b.size_shrink_confirm, { size, count: lost }))) return;
    if (pickFor !== null && pickFor >= size) setPickFor(null);
    update(resizeBingoCells(slots, size, emptySlot));
  };

  const save = async () => {
    setSaving(true);
    try {
      await setYearlyBingo(year, items.length, items);
      showToast(b.saved, 'success');
      setDirty(false);
      onSaved(items);
      onClose();
    } catch (err) {
      showToast(interpolate(b.save_error, { error: formatAppError(err, getT()) }), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} label={title} overlayClassName="bingo-overlay" panelClassName="bingo-modal">
      <header className="bingo-modal-header">
        <div>
          <h2 className="bingo-modal-title">{title}</h2>
          <p className="bingo-modal-subtitle">
            {resultPhase ? b.results_heading : editable ? interpolate(b.editable_until, { date: lockDate }) : interpolate(b.locked_since, { date: lockDate })}
          </p>
        </div>
        <div className="bingo-header-actions">
          <BingoShareButton year={year} cells={items} result={result} ratingSystem={ratingSystem} />
          <span className="bingo-count" aria-label={interpolate(b.filled_label, { count: filled, total: items.length })}>
            {interpolate(b.filled_count, { count: filled, total: items.length })}
          </span>
        </div>
      </header>
      {editable && (
        <div className="bingo-size">
          <label htmlFor={sizeId}>{b.size_label}</label>
          <select id={sizeId} className="bingo-size-select" value={items.length} onChange={e => resize(Number(e.target.value))} disabled={saving}>
            {SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
      {result && <BingoSummary result={result} />}
      <BingoBoard
        slots={slots}
        editable={editable}
        result={result}
        ratingSystem={ratingSystem}
        onAdd={setPickFor}
        onRemove={remove}
        onReorder={reorder}
      />
      {editable && <p className="bingo-hint">{b.edit_hint}</p>}
      <footer className="bingo-modal-footer">
        {editable ? (
          <>
            <button type="button" className="bingo-btn" onClick={onClose} disabled={saving}>{b.cancel}</button>
            <button type="button" className="bingo-btn bingo-btn--primary" onClick={save} disabled={saving || !dirty}>
              {saving ? b.saving : b.save}
            </button>
          </>
        ) : (
          <button type="button" className="bingo-btn" onClick={onClose}>{b.close}</button>
        )}
      </footer>
      {pickFor !== null && (
        <MediaSearchPopup
          onSelect={pick}
          onClose={() => setPickFor(null)}
          excludeIds={items.flatMap(item => (item ? [item.external_id] : []))}
        />
      )}
    </ModalShell>
  );
}
