import { getT } from '../../../i18n/runtime';

export const PR_EDITOR_ROLE_PAGE_SIZE = 16; // 8 cards x 2 rows per role.

export function getRolePageCount(groupSizes: number[]): number {
  return Math.max(1, Math.ceil(Math.max(0, ...groupSizes) / PR_EDITOR_ROLE_PAGE_SIZE));
}

export function getRolePageItems<T>(items: T[], page: number): T[] {
  const start = page * PR_EDITOR_ROLE_PAGE_SIZE;
  return items.slice(start, start + PR_EDITOR_ROLE_PAGE_SIZE);
}

export function PrEditorRolePagination({ page, totalPages, onPageChange }: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const pe = getT().pr_editor;

  return (
    <div className="pr-editor-character-role-pagination">
      <button
        type="button"
        className="pr-editor-btn pr-editor-btn--cancel"
        disabled={page === 0}
        onClick={() => onPageChange(Math.max(0, page - 1))}
        aria-label={pe.page_prev}
      >
        {'<'}
      </button>
      <span>{pe.page_of.replace('{page}', String(page + 1)).replace('{total}', String(totalPages))}</span>
      <button
        type="button"
        className="pr-editor-btn pr-editor-btn--cancel"
        disabled={page >= totalPages - 1}
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        aria-label={pe.page_next}
      >
        {'>'}
      </button>
    </div>
  );
}
