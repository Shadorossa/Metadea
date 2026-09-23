// Home, below the release calendar: the Yearly Bingo cards
// (lib/bingo/bingo-calendar.ts homeBingoCards). Dec 19 – Jan 10: the result
// of the year ending (when a board exists) and the create/edit card for the
// coming one. The rest of the year: the current board, view-only, with its
// progress so far (nothing when there is no board).
import { useEffect, useState, type CSSProperties } from 'react';
import { getT } from '../../i18n/runtime';
import { loadHomeData } from '../../lib/home/home-data';
import { getYearlyBingo, type BingoCell } from '../../lib/tauri/yearly-bingo';
import { bingoLockDate, homeBingoCards } from '../../lib/bingo/bingo-calendar';
import { DEFAULT_BINGO_SIZE, bingoColumns } from '../../lib/bingo/bingo-grid';
import { computeBingoResult, type BingoLibraryRow } from '../../lib/bingo/bingo-result';
import { formatDateLong } from '../../lib/shared/text/format-date';
import { interpolate } from '../../lib/shared/text/interpolate';
import { BingoModal } from './BingoModal';
import { bingoResultLine } from './BingoSummary';

interface Loaded {
  /** null = no board saved for that year. Each board holds exactly its size in cells. */
  resultCells: BingoCell[] | null;
  editCells: BingoCell[] | null;
  viewCells: BingoCell[] | null;
  library: BingoLibraryRow[];
}

/** One dot per cell, filled ones marked — a glance at the board without covers. */
function MiniBoard({ cells, done }: { cells: readonly BingoCell[]; done?: readonly boolean[] }) {
  return (
    <span className="bingo-mini" aria-hidden="true" style={{ '--bingo-cols': bingoColumns(cells.length) } as CSSProperties}>
      {cells.map((cell, i) => (
        <span key={i} className={`bingo-mini-dot${cell ? ' is-filled' : ''}${done?.[i] ? ' is-done' : ''}`} />
      ))}
    </span>
  );
}

export function BingoHomeSection() {
  const b = getT().bingo;
  const [now] = useState(() => new Date());
  const { resultYear, editYear, viewYear } = homeBingoCards(now);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [openYear, setOpenYear] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      resultYear === null ? null : getYearlyBingo(resultYear),
      editYear === null ? null : getYearlyBingo(editYear),
      viewYear === null ? null : getYearlyBingo(viewYear),
      loadHomeData(),
    ]).then(([result, edit, view, { items }]) => {
      if (!cancelled) {
        setLoaded({
          resultCells: result?.items ?? null,
          editCells: edit?.items ?? null,
          viewCells: view?.items?.some(Boolean) ? view.items : null,
          library: items,
        });
      }
    }).catch(err => {
      // No card beats a "create" card that could overwrite an unread board.
      console.error('[bingo] failed to load', err);
    });
    return () => { cancelled = true; };
  }, [resultYear, editYear, viewYear]);

  if (!loaded) return null;
  const { resultCells, editCells, viewCells, library } = loaded;
  const result = resultYear !== null && resultCells ? computeBingoResult(resultCells, library, resultYear) : null;
  const progress = viewYear !== null && viewCells ? computeBingoResult(viewCells, library, viewYear) : null;
  const showEdit = editYear !== null;
  if (!result && !showEdit && !progress) return null;

  const editFilled = editCells?.filter(Boolean).length ?? 0;
  const openCells = openYear === resultYear ? resultCells : openYear === viewYear ? viewCells : editCells;

  return (
    <section className="home-bingo-section" aria-label={interpolate(b.title, { year: editYear ?? resultYear ?? now.getFullYear() })}>
      {result && resultYear !== null && resultCells && (
        <div className="home-card home-bingo-card">
          <MiniBoard cells={resultCells} done={result.cells.map(c => c.done)} />
          <div className="home-bingo-text">
            <h3 className="home-card-title">{interpolate(b.home_result_heading, { year: resultYear })}</h3>
            <p className="home-bingo-line">{bingoResultLine(result)}</p>
          </div>
          <button type="button" className="bingo-btn" onClick={() => setOpenYear(resultYear)}>{b.home_see_results}</button>
        </div>
      )}
      {progress && viewYear !== null && viewCells && (
        <div className="home-card home-bingo-card">
          <MiniBoard cells={viewCells} done={progress.cells.map(c => c.done)} />
          <div className="home-bingo-text">
            <h3 className="home-card-title">{interpolate(b.title, { year: viewYear })}</h3>
            <p className="home-bingo-line">
              {interpolate(b.home_view_progress, { done: progress.done, total: progress.size, percent: progress.percent })}
            </p>
          </div>
          <button type="button" className="bingo-btn" onClick={() => setOpenYear(viewYear)}>{b.home_view}</button>
        </div>
      )}
      {showEdit && (
        <div className="home-card home-bingo-card">
          <MiniBoard cells={editCells ?? Array.from({ length: DEFAULT_BINGO_SIZE }, () => null)} />
          <div className="home-bingo-text">
            <h3 className="home-card-title">{interpolate(b.title, { year: editYear })}</h3>
            <p className="home-bingo-line">
              {editCells
                ? interpolate(b.home_progress, { count: editFilled, total: editCells.length, date: formatDateLong(bingoLockDate(editYear)) })
                : interpolate(b.home_intro, { year: editYear, date: formatDateLong(bingoLockDate(editYear)) })}
            </p>
          </div>
          <button type="button" className="bingo-btn bingo-btn--primary" onClick={() => setOpenYear(editYear)}>
            {editCells ? b.home_edit : b.home_create}
          </button>
        </div>
      )}
      {openYear !== null && (
        <BingoModal
          year={openYear}
          cells={openCells}
          library={library}
          now={now}
          onClose={() => setOpenYear(null)}
          onSaved={cells => setLoaded(prev => (prev && openYear === editYear
            ? { ...prev, editCells: cells.some(Boolean) ? cells : null }
            : prev))}
        />
      )}
    </section>
  );
}
