// Company page island (/company?id=<provider>:<id>): a developer,
// publisher, studio, producer or network and everything it has made, with
// the user's completion over it. Data: src-tauri/src/company_catalog via
// useCompanyPage (cached, stale-while-revalidate, streamed in chunks).
import { useMemo, useState } from 'react';
import type { Translations } from '../../i18n/index';
import { getT } from '../../i18n/runtime';
import { formatAppError } from '../../lib/errors/format-error';
import { applySearchExclusions, DEFAULT_COMPANY_WORK_FILTERS, type CompanyWorkFilters } from '../../lib/company/company-works';
import type { CreatorWorkRef } from '../../lib/media/creator-completion';
import { CreatorCompletionBar } from '../shared/CreatorCompletionBar';
import { useLibrarySnapshot } from '../shared/hooks/useLibrarySnapshot';
import { useHydrated } from '../shared/hooks/useHydrated';
import { CompanyHeader } from './CompanyHeader';
import { CompanyWorks } from './CompanyWorks';
import { useCompanyPage } from './hooks/useCompanyPage';
import { useSearchExclusions } from './hooks/useSearchExclusions';

type CompanyPageStrings = Pick<Translations, 'company_page' | 'creator_completion' | 'errors'> & {
  types: Translations['search']['types'];
};

interface Props {
  i18n: CompanyPageStrings;
}

export default function CompanyPage({ i18n: staticStrings }: Props) {
  // The static build renders English; once hydrated the island switches to
  // the resolved locale (the server/hydration pass only shows the spinner).
  const hydrated = useHydrated();
  const i18n = useMemo<CompanyPageStrings>(() => {
    if (!hydrated) return staticStrings;
    const rt = getT();
    return { company_page: rt.company_page, creator_completion: rt.creator_completion, errors: rt.errors, types: rt.search.types };
  }, [hydrated, staticStrings]);
  const t = i18n.company_page;
  const state = useCompanyPage();
  const snapshot = useLibrarySnapshot();
  const [filters, setFilters] = useState<CompanyWorkFilters>(DEFAULT_COMPANY_WORK_FILTERS);

  const rawWorks = state.status === 'ready' ? state.payload.page.works : null;
  const exclusions = useSearchExclusions(rawWorks, state.status === 'ready' ? state.payload.page.source : '');
  // Search's exclusions first, so the grid, the timeline and the meter
  // all count the same works Search would list.
  const works = useMemo(() => (rawWorks ? applySearchExclusions(rawWorks, exclusions) : null), [rawWorks, exclusions]);
  const completionWorks = useMemo<CreatorWorkRef[]>(() => (works ?? []).map(work => ({
    externalId: work.external_id,
    type: work.media_type,
    unreleased: work.unreleased,
    isExtra: work.is_extra,
  })), [works]);

  if (state.status === 'loading') {
    return <div className="media-loading"><div className="spinner" /></div>;
  }
  if (state.status === 'error') {
    const message = state.reason === 'failed' ? formatAppError(state.cause, i18n)
      : state.reason === 'desktop_only' ? t.desktop_only
      : t.missing_id;
    return <div className="media-error company-error" role="alert">{message}</div>;
  }

  const { page } = state.payload;
  const notice = state.refreshing ? t.refreshing
    : state.cachedOnly ? t.cached_copy
    : page.source === 'local' ? t.source_local
    : null;

  return (
    <div className="company-page">
      <CompanyHeader page={page} t={t}>
        <CreatorCompletionBar
          kind="company"
          name={page.name}
          works={completionWorks}
          snapshot={snapshot}
          includeExtras={filters.includeExtras}
          strings={i18n.creator_completion}
        />
      </CompanyHeader>
      {notice && <p className="company-notice" role="status">{notice}</p>}
      <CompanyWorks
        works={works ?? []}
        filters={filters}
        onFiltersChange={setFilters}
        snapshot={snapshot}
        loadingMore={state.loadingMore}
        t={t}
        tc={i18n.creator_completion}
        types={i18n.types}
      />
    </div>
  );
}
