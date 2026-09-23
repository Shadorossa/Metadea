import { useState } from 'react';
import {
  appearancesPageSlice,
  appearancesTotalPages,
  type MergedAppearance,
} from '../../../lib/character/character-appearances';
import type { CharacterStrings } from '../../../lib/character/character-stat-labels';
import { attributeUrl } from '../../../lib/character/character-page-urls';

function AppearanceCard({ app }: { app: MergedAppearance }) {
  const cover = app.cover ? attributeUrl(app.cover) : '';
  return (
    <a href={`/media?id=${encodeURIComponent(app.mediaId)}`} className="media-relation-card">
      {app.cover && <div className="media-relation-bg-layer"><img src={cover} alt="" /></div>}
      <div className="media-relation-card-overlay"></div>
      <div className="media-relation-card-content">
        <div className="media-relation-thumb">
          {app.cover && <img src={cover} alt={app.title} loading="lazy" />}
        </div>
        <div className="media-relation-info">
          <span className="media-relation-title">{app.title}</span>
        </div>
      </div>
      {app.roleLabel && <div className="media-relation-type">{app.roleLabel}</div>}
    </a>
  );
}

export function CharacterAppearances({ appearances, t }: { appearances: MergedAppearance[]; t: CharacterStrings }) {
  const [page, setPage] = useState(1);
  const totalPages = appearancesTotalPages(appearances.length);
  const currentPage = Math.min(page, totalPages || 1);
  const slice = appearancesPageSlice(appearances, currentPage);

  return (
    <div className="media-col-related" id="char-appearances-section" style={{ display: appearances.length > 0 ? 'block' : 'none' }}>
      <div className="media-section-header-row">
        <p className="section-label">{t.appearances}</p>
        <div className="media-section-header-line"></div>
      </div>
      <div className="media-relations-grid" id="char-appearances-grid">
        {slice.map(app => <AppearanceCard key={app.mediaId} app={app} />)}
      </div>

      <div
        id="appearances-pagination"
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
        <button
          className="btn btn--sm btn--secondary"
          id="btn-prev-appearances"
          style={{ minWidth: '100px' }}
          disabled={currentPage === 1}
          onClick={() => { if (currentPage > 1) setPage(currentPage - 1); }}
        >
          {t.pagination_prev}
        </button>
        <span id="txt-appearances-page" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {t.pagination_page.replace('{page}', String(currentPage)).replace('{total}', String(totalPages || 1))}
        </span>
        <button
          className="btn btn--sm btn--secondary"
          id="btn-next-appearances"
          style={{ minWidth: '100px' }}
          disabled={currentPage >= totalPages}
          onClick={() => { if (currentPage < totalPages) setPage(currentPage + 1); }}
        >
          {t.pagination_next}
        </button>
      </div>
    </div>
  );
}
