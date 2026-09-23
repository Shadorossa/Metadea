// Author page island: same DOM structure, ids and class names as the
// former author.astro markup so styles/pages/character.css and media.css
// apply unchanged.
import { useEffect, useMemo, useState } from 'react';
import type { Translations } from '../../i18n/index';
import { getT } from '../../i18n/runtime';
import {
  AUTHOR_WORKS_PER_PAGE,
  authorRoleLabel,
  authorWorkExternalId,
  loadAuthorPageData,
  type AuthorPageLoadResult,
  type AuthorRenderData,
  type AuthorWorkCard,
} from '../../lib/author/author-page-data';
import { interpolate } from '../../lib/shared/text/interpolate';
import { attributeUrl } from '../../lib/character/character-page-urls';
import { sanitizeHtml } from '../../lib/shared/text/sanitize-html';
import { workLibraryState, workProgressRatio, type CreatorWorkRef } from '../../lib/media/creator-completion';
import { CreatorCompletionBar } from '../shared/CreatorCompletionBar';
import { CreatorWorkState, creatorWorkClass } from '../shared/CreatorWorkState';
import { CareerTimeline, type CareerTimelineItem } from '../shared/CareerTimeline';
import { CreatorViewSwitch, useCreatorWorksView } from '../shared/CreatorViewSwitch';
import { isMasterpiece } from '../../lib/media/career-timeline';
import { useLibrarySnapshot, type LibrarySnapshot } from '../shared/hooks/useLibrarySnapshot';
import { useHydrated } from '../shared/hooks/useHydrated';

type AuthorPageStrings = Pick<Translations, 'author_page' | 'character' | 'creator_completion'>;

interface Props {
  i18n: AuthorPageStrings;
}

type PageState = { status: 'loading' } | AuthorPageLoadResult;

function errorMessage(state: Extract<AuthorPageLoadResult, { status: 'error' }>, t: Translations['author_page']): string {
  switch (state.reason) {
    case 'invalid_id': return t.errors.invalid_id;
    case 'tmdb_unavailable': return t.error_tmdb;
    case 'unsupported_provider': return interpolate(t.errors.unsupported_provider, { provider: state.detail ?? '' });
    case 'not_found': return interpolate(t.errors.not_found, { source: state.detail ?? '' });
    case 'failed': return state.detail ? `${t.errors.failed}: ${state.detail}` : t.errors.failed;
  }
}

function WorkCard({ work, snapshot, tc, t }: {
  work: AuthorWorkCard;
  snapshot: LibrarySnapshot | null;
  tc: Translations['creator_completion'];
  t: Translations['author_page'];
}) {
  const cover = work.cover ? attributeUrl(work.cover) : '';
  const externalId = authorWorkExternalId(work);
  const row = snapshot?.libraryById.get(externalId);
  const state = snapshot ? workLibraryState(row) : null;
  const progress = state === 'in_progress' ? workProgressRatio(row, snapshot?.catalogById.get(externalId)?.total_count) : null;
  const title = work.title || t.unknown_title;
  return (
    <a href={work.url} className={`media-relation-card${creatorWorkClass(state)}`}>
      {work.cover && <div className="media-relation-bg-layer"><img src={cover} alt="" loading="lazy" /></div>}
      <div className="media-relation-card-overlay"></div>
      <div className="media-relation-card-content">
        <div className="media-relation-thumb">
          {work.cover && <img src={cover} alt={title} loading="lazy" />}
        </div>
        <div className="media-relation-info">
          <span className="media-relation-title">{title}</span>
        </div>
      </div>
      {work.role && <div className="media-relation-type">{authorRoleLabel(work.role, t.roles)}</div>}
      <CreatorWorkState state={state} progress={progress} strings={tc} />
    </a>
  );
}

// Timeline entries: the provider's year, else the local catalog's (works
// rebuilt from the local author tables carry none of their own).
function authorTimelineItems(works: readonly AuthorWorkCard[], snapshot: LibrarySnapshot | null, t: Translations['author_page']): CareerTimelineItem[] {
  return works.map(work => {
    const externalId = authorWorkExternalId(work);
    const row = snapshot?.libraryById.get(externalId);
    const catalog = snapshot?.catalogById.get(externalId);
    const state = snapshot ? workLibraryState(row) : null;
    return {
      id: externalId,
      href: work.url,
      title: work.title || t.unknown_title,
      year: work.year ?? catalog?.release_year ?? null,
      cover: work.cover ? attributeUrl(work.cover) : null,
      score: work.score,
      state,
      progress: state === 'in_progress' ? workProgressRatio(row, catalog?.total_count) : null,
      unreleased: catalog?.status === 'NOT_YET_RELEASED',
    };
  });
}

// 4 rows x .media-relations-grid's own 4 columns (media.css) per page —
// same paginated pattern as the character page's Apariciones. The
// Grid | Timeline switch and "Masterpieces only" sit in a row of their own.
function AuthorWorks({ works: allWorks, t, tp, snapshot, tc }: {
  works: AuthorWorkCard[];
  t: Translations['author_page'];
  tp: Translations['character'];
  snapshot: LibrarySnapshot | null;
  tc: Translations['creator_completion'];
}) {
  const [page, setPage] = useState(1);
  const [view, setView] = useCreatorWorksView('author');
  const [masterpiecesOnly, setMasterpiecesOnly] = useState(false);
  const anyMasterpiece = useMemo(() => allWorks.some(w => isMasterpiece(w.score)), [allWorks]);
  const works = useMemo(
    () => (masterpiecesOnly && anyMasterpiece ? allWorks.filter(w => isMasterpiece(w.score)) : allWorks),
    [allWorks, masterpiecesOnly, anyMasterpiece],
  );
  const timelineItems = useMemo(
    () => (view === 'timeline' ? authorTimelineItems(works, snapshot, t) : []),
    [view, works, snapshot, t],
  );
  const totalPages = Math.ceil(works.length / AUTHOR_WORKS_PER_PAGE);
  const currentPage = Math.min(page, totalPages || 1);
  const start = (currentPage - 1) * AUTHOR_WORKS_PER_PAGE;
  const slice = works.slice(start, start + AUTHOR_WORKS_PER_PAGE);

  return (
    <div className="media-col-related" id="author-works-section" style={{ display: allWorks.length > 0 ? 'block' : 'none' }}>
      <div className="media-section-header-row">
        <p className="section-label">{t.works}</p>
        <div className="media-section-header-line"></div>
      </div>
      <div className="author-works-toolbar">
        {anyMasterpiece && (
          <label className="author-works-toggle">
            <input type="checkbox" checked={masterpiecesOnly} onChange={e => { setMasterpiecesOnly(e.target.checked); setPage(1); }} />
            <span>{tc.masterpieces_only}</span>
          </label>
        )}
        <CreatorViewSwitch view={view} onChange={setView} strings={tc} />
      </div>
      {view === 'timeline' && <CareerTimeline items={timelineItems} strings={tc} />}
      <div className="media-relations-grid" id="author-works-grid" style={view === 'timeline' ? { display: 'none' } : undefined}>
        {slice.map(work => <WorkCard key={work.url} work={work} snapshot={snapshot} tc={tc} t={t} />)}
      </div>

      <div
        id="author-works-pagination"
        style={{
          display: view === 'grid' && totalPages > 1 ? 'flex' : 'none',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '1.5rem',
          marginTop: '2rem',
          borderTop: '1px solid var(--border-color)',
          paddingTop: '1.5rem',
        }}
      >
        <button className="btn btn--sm btn--secondary" id="btn-prev-works" style={{ minWidth: '100px' }} disabled={currentPage === 1} onClick={() => { if (currentPage > 1) setPage(currentPage - 1); }}>
          {tp.pagination_prev}
        </button>
        <span id="txt-works-page" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {tp.pagination_page.replace('{page}', String(currentPage)).replace('{total}', String(totalPages || 1))}
        </span>
        <button className="btn btn--sm btn--secondary" id="btn-next-works" style={{ minWidth: '100px' }} disabled={currentPage >= totalPages} onClick={() => { if (currentPage < totalPages) setPage(currentPage + 1); }}>
          {tp.pagination_next}
        </button>
      </div>
    </div>
  );
}

export default function AuthorPage({ i18n: staticStrings }: Props) {
  // The static build renders English; once hydrated the island switches to
  // the resolved locale (the server/hydration pass only shows the spinner).
  const hydrated = useHydrated();
  const i18n = useMemo<AuthorPageStrings>(() => {
    if (!hydrated) return staticStrings;
    const rt = getT();
    return { author_page: rt.author_page, character: rt.character, creator_completion: rt.creator_completion };
  }, [hydrated, staticStrings]);
  const t = i18n.author_page;
  const tc = i18n.character;
  const tcc = i18n.creator_completion;
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const snapshot = useLibrarySnapshot();
  const works = state.status === 'ready' ? state.data.works : null;
  // Type from the id prefix; release state comes from the catalog rows the
  // completion math already reads.
  const completionWorks = useMemo<CreatorWorkRef[]>(() => (works ?? []).map(work => {
    const externalId = authorWorkExternalId(work);
    return { externalId, type: externalId.split(':')[0] };
  }), [works]);

  useEffect(() => {
    let cancelled = false;
    const externalId = new URLSearchParams(window.location.search).get('id') ?? '';
    loadAuthorPageData(externalId).then(result => {
      if (!cancelled) setState(result);
    });
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading') {
    return (
      <div id="author-loading" className="media-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div id="author-error" className="media-error" style={{ display: 'block' }}>
        <span id="author-error-text">{errorMessage(state, t)}</span>
      </div>
    );
  }

  const { data } = state;
  const hasStats = !!(data.birthDate || data.deathDate);

  return (
    <div id="author-content" style={{ display: 'block' }}>
      <div className="character-grid">
        <div className="character-main-content">
          <div className="character-hero-left-col">
            <div className="character-avatar-frame">
              <div className="character-avatar-wrap" id="author-avatar-container">
                {data.image
                  ? <img src={attributeUrl(data.image)} alt={data.name} className="character-avatar-img" />
                  : <div className="character-avatar-placeholder">{tc.no_image}</div>}
              </div>
            </div>
          </div>

          <div className="character-hero-right-col">
            <div className="character-name-row">
              <h1 className="media-title-main" id="author-name-full">{data.name}</h1>
            </div>
            <p className="media-title-native" id="author-name-native" style={{ display: data.nameNative ? 'block' : 'none', marginTop: '0.25rem' }}>
              {data.nameNative}
            </p>

            <div className="character-alt-names-wrap" id="author-alt-names-wrap" style={{ display: data.aliases.length > 0 ? 'block' : 'none' }}>
              <div className="character-alt-names" id="author-alt-names">
                {data.aliases.map(alt => <span key={alt} className="character-alt-name-tag">{alt}</span>)}
              </div>
            </div>

            <CreatorCompletionBar kind="author" name={data.name} works={completionWorks} snapshot={snapshot} strings={tcc} />
          </div>

          <div className="media-col-synopsis" id="author-bio-section" style={{ display: data.biography ? 'block' : 'none' }}>
            <div className="media-section-header-row">
              <p className="section-label">{tc.biography}</p>
              <div className="media-section-header-line"></div>
            </div>
            {/* Third-party biography markup (AniList/OpenLibrary) — sanitized, never raw. */}
            <div className="media-description-text" id="author-description" dangerouslySetInnerHTML={{ __html: data.biography ? sanitizeHtml(data.biography) : '' }} />
          </div>

          <AuthorWorks works={data.works} t={t} tp={tc} snapshot={snapshot} tc={tcc} />
        </div>

        <div className="media-col-stats character-hero-stats" id="author-stats-card" style={{ display: hasStats ? 'block' : 'none' }}>
          <div className="media-section-header-row">
            <p className="section-label">{tc.details}</p>
            <div className="media-section-header-line"></div>
          </div>
          <div className="media-stats-list" id="author-stats-list">
            {data.birthDate && (
              <div className="media-stat-item"><span className="media-stat-label">{t.birth_date}</span><span className="media-stat-value">{data.birthDate}</span></div>
            )}
            {data.deathDate && (
              <div className="media-stat-item"><span className="media-stat-label">{t.death_date}</span><span className="media-stat-value">{data.deathDate}</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
