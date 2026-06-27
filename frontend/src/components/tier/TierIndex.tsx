import { useState } from 'react';

export default function TierIndex() {
  const [search, setSearch] = useState('');

  return (
    <div className="tier-index">
      <div className="tier-index-header">
        <h1 className="tier-index-title">Tier Lists</h1>
        <a href="/tier/new" className="tier-index-create-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Nueva tier list
        </a>
      </div>

      <div className="tier-index-search-wrap">
        <svg className="tier-index-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
        </svg>
        <input
          className="tier-index-search"
          type="text"
          placeholder="Buscar tier lists de otros usuarios…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {search
        ? (
          <div className="tier-index-empty">
            <p>La búsqueda de tier lists de comunidad estará disponible próximamente.</p>
          </div>
        )
        : (
          <div className="tier-index-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.25">
              <rect x="3" y="3" width="18" height="5" rx="1"/>
              <rect x="3" y="10" width="18" height="5" rx="1"/>
              <rect x="3" y="17" width="18" height="5" rx="1"/>
            </svg>
            <p>Aún no hay tier lists guardadas.</p>
            <a href="/tier/new" className="tier-index-create-btn">
              Crear mi primera tier list
            </a>
          </div>
        )
      }
    </div>
  );
}
