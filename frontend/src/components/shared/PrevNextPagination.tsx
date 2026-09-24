import type { KeyboardEvent } from 'react';

interface Props {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  /** "Previous" / "Next" / "Page {page} of {total}". */
  strings: { prev: string; next: string; page: string };
  /** Ids for the parts, for pages that script against them. */
  ids?: { root?: string; prev?: string; next?: string; label?: string };
  className?: string;
  /** ‹ / › buttons (their labels as tooltips) for narrow columns. */
  compact?: boolean;
}

/** "Previous · Page X of Y · Next" under a paged grid (the creator page's
 *  works and its Sakuga row). Renders nothing for a single page. ←/→ page
 *  while a button inside has focus. */
export function PrevNextPagination({ page, totalPages, onChange, strings, ids, className, compact = false }: Props) {
  if (totalPages <= 1) return null;
  const go = (next: number) => { if (next >= 1 && next <= totalPages && next !== page) onChange(next); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(page - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(page + 1); }
  };
  return (
    <div
      id={ids?.root}
      className={`prev-next-pagination${compact ? ' prev-next-pagination--compact' : ''}${className ? ` ${className}` : ''}`}
      onKeyDown={onKeyDown}
    >
      <button type="button" className="btn btn--sm btn--secondary prev-next-pagination__btn" id={ids?.prev} disabled={page <= 1} onClick={() => go(page - 1)} aria-label={compact ? strings.prev : undefined} title={compact ? strings.prev : undefined}>
        {compact ? '‹' : strings.prev}
      </button>
      <span className="prev-next-pagination__label" id={ids?.label}>
        {strings.page.replace('{page}', String(page)).replace('{total}', String(totalPages))}
      </span>
      <button type="button" className="btn btn--sm btn--secondary prev-next-pagination__btn" id={ids?.next} disabled={page >= totalPages} onClick={() => go(page + 1)} aria-label={compact ? strings.next : undefined} title={compact ? strings.next : undefined}>
        {compact ? '›' : strings.next}
      </button>
    </div>
  );
}
