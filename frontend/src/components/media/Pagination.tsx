import { useState, useRef, useEffect } from 'react';

interface Props {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}

// Builds the compact "1 ... 4 5 6 ... 25" page list — always keeps first,
// last, and a small window around the current page, collapsing everything
// else into a single "..." (a non-interactive gap — clicking the current
// page number itself is how you jump to an arbitrary page, see below).
function buildPageList(current: number, total: number): (number | 'gap')[] {
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: (number | 'gap')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('gap');
    result.push(sorted[i]);
  }
  return result;
}

export function Pagination({ currentPage, totalPages, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Editing is always tied to whatever the current page is right now — if it
  // changes from elsewhere while mid-edit (shouldn't normally happen, but is
  // exactly the state that would go stale otherwise), drop back to display mode.
  useEffect(() => { setEditing(false); }, [currentPage]);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  if (totalPages <= 1) return null;

  const startEditing = () => {
    setEditValue(String(currentPage));
    setEditing(true);
  };

  const commitEdit = () => {
    const page = parseInt(editValue, 10);
    if (Number.isFinite(page) && page >= 1 && page <= totalPages && page !== currentPage) {
      onChange(page);
    }
    setEditing(false);
  };

  // Below ~9 pages the compact "..." form saves nothing over just listing
  // every page, so it only kicks in once collapsing actually helps.
  const useCompactForm = totalPages > 9;
  const pageList = useCompactForm ? buildPageList(currentPage, totalPages) : Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="media-pagination">
      {pageList.map((p, i) => {
        if (p === 'gap') return <span key={`gap-${i}`} className="media-pagination-gap">...</span>;

        const isCurrent = currentPage === p;
        if (isCurrent && editing) {
          return (
            <input
              key={p}
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="media-pagination-page media-pagination-page--editing"
              value={editValue}
              onChange={e => setEditValue(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                else if (e.key === 'Escape') setEditing(false);
              }}
            />
          );
        }

        return (
          <button
            key={p}
            type="button"
            className={`media-pagination-page${isCurrent ? ' active' : ''}`}
            onClick={() => (isCurrent ? startEditing() : onChange(p))}
            title={isCurrent ? 'Haz clic para escribir una página' : undefined}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}
