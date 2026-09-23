import { useMemo, useState } from 'react';
import { getT } from '../../../i18n/runtime';
import { backfillMissingCatalogFields, type BackfillEntryResult, type BackfillProgress } from '../../settings/mount/catalog-backfill';
import type { AdminPaging } from '../useAdminPaging';

interface Props {
  active: boolean;
  paging: AdminPaging;
  // The sweep writes into the local catalog, so the local tab re-reads it.
  onCompleted: () => void;
}

// One-off backfill sweep (see catalog-backfill.ts) for rows missing the
// fields added this session (country_code, release_end_*, title_english).
// Stays mounted while hidden so a finished sweep's results survive a tab
// switch.
export function BackfillTab({ active, paging, onCompleted }: Props) {
  const pe = getT().pr_editor;
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [backfillResults, setBackfillResults] = useState<BackfillEntryResult[] | null>(null);

  const runBackfill = async () => {
    if (backfillRunning) return;
    setBackfillRunning(true);
    setBackfillResults(null);
    setBackfillProgress(null);
    try {
      const results = await backfillMissingCatalogFields(p => setBackfillProgress(p));
      setBackfillResults(results);
      onCompleted();
    } finally {
      setBackfillRunning(false);
    }
  };

  const pagedBackfillResults = useMemo(
    () => paging.pageItems('backfill-results', backfillResults ?? []),
    [paging, backfillResults],
  );

  if (!active) return null;

  return (
    <div className="catalog-backfill">
      <button
        type="button"
        className="catalog-admin-source-btn"
        onClick={runBackfill}
        disabled={backfillRunning}
      >
        {backfillRunning ? getT().admin.backfill_running : getT().admin.backfill_run}
      </button>
      {backfillRunning && backfillProgress && (
        <p className="catalog-admin-status">
          {backfillProgress.done} / {backfillProgress.total} — {backfillProgress.current}
        </p>
      )}
      {!backfillRunning && backfillResults && (
        <>
        <div className="catalog-backfill-results">
          {backfillResults.length === 0 ? (
            <p className="catalog-admin-status">{pe.backfill_nothing_to_update}</p>
          ) : (
            pagedBackfillResults.items.map(entry => (
              <div key={entry.externalId} className="catalog-backfill-entry">
                <p className="catalog-backfill-entry-title">{entry.titleMain}</p>
                <div className="catalog-backfill-fields">
                  {entry.fields.map(f => (
                    <span
                      key={f.field}
                      className={`catalog-backfill-field${f.changed ? ' catalog-backfill-field--changed' : ''}`}
                    >
                      {f.label}: {f.after == null || f.after === '' ? '—' : String(f.after)}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        {paging.renderPagination('backfill-results', pagedBackfillResults.totalPages, pagedBackfillResults.currentPage)}
        </>
      )}
    </div>
  );
}
