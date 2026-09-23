// Author page island: same DOM structure, ids and class names as the
// former author.astro markup so styles/pages/character.css and media.css
// apply unchanged.
import { useEffect, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import {
  AUTHOR_WORKS_PER_PAGE,
  loadAuthorPageData,
  type AuthorRenderData,
  type AuthorWorkCard,
} from '../../../lib/character/author-page-data';
import { attributeUrl } from '../../../lib/character/character-page-urls';
import { sanitizeHtml } from '../../../lib/shared/text/sanitize-html';

interface Props {
  i18n: Pick<Translations, 'author_page' | 'character'>;
}

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AuthorRenderData };

function WorkCard({ work }: { work: AuthorWorkCard }) {
  const cover = work.cover ? attributeUrl(work.cover) : '';
  return (
    <a href={work.url} className="media-relation-card">
      {work.cover && <div className="media-relation-bg-layer"><img src={cover} alt="" loading="lazy" /></div>}
      <div className="media-relation-card-overlay"></div>
      <div className="media-relation-card-content">
        <div className="media-relation-thumb">
          {work.cover && <img src={cover} alt={work.title} loading="lazy" />}
        </div>
        <div className="media-relation-info">
          <span className="media-relation-title">{work.title}</span>
        </div>
      </div>
      {work.role && <div className="media-relation-type">{work.role}</div>}
    </a>
  );
}

// 4 rows x .media-relations-grid's own 4 columns (media.css) per page —
// same paginated pattern as the character page's Apariciones.
function AuthorWorks({ works, label, t }: { works: AuthorWorkCard[]; label: string; t: Translations['character'] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(works.length / AUTHOR_WORKS_PER_PAGE);
  const currentPage = Math.min(page, totalPages || 1);
  const start = (currentPage - 1) * AUTHOR_WORKS_PER_PAGE;
  const slice = works.slice(start, start + AUTHOR_WORKS_PER_PAGE);

  return (
    <div className="media-col-related" id="author-works-section" style={{ display: works.length > 0 ? 'block' : 'none' }}>
      <div className="media-section-header-row">
        <p className="section-label">{label}</p>
        <div className="media-section-header-line"></div>
      </div>
      <div className="media-relations-grid" id="author-works-grid">
        {slice.map(work => <WorkCard key={work.url} work={work} />)}
      </div>

      <div
        id="author-works-pagination"
        style={{
          display: totalPages > 1 ? 'flex' : 'none',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '1.5rem',
          marginTop: '2rem',
          borderTop: '1px solid var(--border-color)',
          paddingTop: '1.5rem',
        }}
      >
        <button className="btn btn--sm btn--secondary" id="btn-prev-works" style={{ minWidth: '100px' }} disabled={currentPage === 1} onClick={() => { if (currentPage > 1) setPage(currentPage - 1); }}>
          {t.pagination_prev}
        </button>
        <span id="txt-works-page" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {t.pagination_page.replace('{page}', String(currentPage)).replace('{total}', String(totalPages || 1))}
        </span>
        <button className="btn btn--sm btn--secondary" id="btn-next-works" style={{ minWidth: '100px' }} disabled={currentPage >= totalPages} onClick={() => { if (currentPage < totalPages) setPage(currentPage + 1); }}>
          {t.pagination_next}
        </button>
      </div>
    </div>
  );
}

export default function AuthorPage({ i18n }: Props) {
  const t = i18n.author_page;
  const tc = i18n.character;
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const externalId = new URLSearchParams(window.location.search).get('id') ?? '';
    loadAuthorPageData(externalId, t.error_tmdb).then(result => {
      if (!cancelled) setState(result);
    });
    return () => { cancelled = true; };
  }, [t.error_tmdb]);

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
        <span id="author-error-text">{state.message}</span>
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
          </div>

          <div className="media-col-synopsis" id="author-bio-section" style={{ display: data.biography ? 'block' : 'none' }}>
            <div className="media-section-header-row">
              <p className="section-label">{tc.biography}</p>
              <div className="media-section-header-line"></div>
            </div>
            {/* Third-party biography markup (AniList/OpenLibrary) — sanitized, never raw. */}
            <div className="media-description-text" id="author-description" dangerouslySetInnerHTML={{ __html: data.biography ? sanitizeHtml(data.biography) : '' }} />
          </div>

          <AuthorWorks works={data.works} label={t.works} t={tc} />
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
