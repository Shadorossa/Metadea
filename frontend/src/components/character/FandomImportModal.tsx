import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchFandomCharacter, type FandomCharacterData } from '../../lib/character/fandomImporter';
import { correlateVoiceActors } from '../../lib/character/voiceActorResolver';
import { getT } from '../../i18n/client';

export interface SelectedImportFields {
  name: boolean;
  image: boolean;
  aliases: boolean;
  characteristics: boolean;
  biography: boolean;
  voiceActors: boolean;
}

export interface FandomImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (data: FandomCharacterData, fields: SelectedImportFields) => void;
}

export function FandomImportModal({ isOpen, onClose, onApply }: FandomImportModalProps) {
  const t = getT().character_editor;
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FandomCharacterData | null>(null);

  const [selectedFields, setSelectedFields] = useState<SelectedImportFields>({
    name: true,
    image: true,
    aliases: true,
    characteristics: true,
    biography: true,
    voiceActors: true,
  });

  if (!isOpen) return null;

  const handleFetch = async () => {
    if (!url.trim()) {
      setError('Por favor, introduce una URL de Fandom');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await fetchFandomCharacter(url);
      if (result.voiceActors && result.voiceActors.length > 0) {
        const correlated = await correlateVoiceActors(result.voiceActors);
        result.voiceActors = correlated.map(c => ({
          name: c.name,
          language: c.language,
          externalId: c.externalId,
          native: c.native,
          image: c.image,
          matchedFrom: c.matchedFrom,
        }));
      }
      setData(result);
    } catch (err: any) {
      console.error('Error al importar de Fandom:', err);
      setError(err?.message || t.import_fandom_fetching);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!data) return;
    onApply(data, selectedFields);
    onClose();
  };

  const toggleField = (key: keyof SelectedImportFields) => {
    setSelectedFields(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const modalContent = (
    <div className="pr-editor-search-popup" onClick={onClose}>
      <div
        className="pr-editor-search-popup-content pr-editor-search-popup-content--wide"
        onClick={e => e.stopPropagation()}
        style={{ padding: '1.5rem', maxHeight: '85vh', overflowY: 'auto' }}
      >
        {/* Cabecera del modal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color, #2d2a24)', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent, #7c6af7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main, #eae6df)' }}>
              {t.import_fandom_title}
            </span>
          </div>
          <button
            type="button"
            className="fandom-import-close-btn"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted, #8a857a)', cursor: 'pointer', fontSize: '1.25rem', padding: '0.25rem' }}
          >
            ✕
          </button>
        </div>

        {/* Barra de entrada de URL */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            placeholder={t.import_fandom_url_ph}
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleFetch(); } }}
            autoFocus
            className="input-dark"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="pr-editor-btn pr-editor-btn--primary fandom-import-fetch-btn"
            onClick={handleFetch}
            disabled={loading}
            style={{ minWidth: '130px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
          >
            {loading ? (
              <div className="spinner spinner--small" style={{ width: '14px', height: '14px', border: '2px solid rgba(0,0,0,0.2)', borderTopColor: 'currentColor', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            ) : t.import_fandom_fetch}
          </button>
        </div>

        {error && (
          <div className="pr-editor-alert pr-editor-alert--error" style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: 'var(--radius-sm, 4px)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {/* Vista previa y selección de campos */}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
            <div className="fandom-import-preview-card" style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '1.25rem', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm, 4px)', padding: '1rem' }}>
              <div>
                {data.imageUrl ? (
                  <img
                    src={data.imageUrl}
                    alt={data.name}
                    className="fandom-import-preview-img"
                    style={{ width: '100px', height: '130px', objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)', border: '1px solid var(--border-color)' }}
                  />
                ) : (
                  <div className="fandom-import-preview-img-ph" style={{ width: '100px', height: '130px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm, 4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {t.no_image}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-main)' }}>{data.name}</span>
                  <span className="fandom-import-wiki-tag" style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 'var(--radius-sm, 4px)', border: '1px solid var(--border-color)' }}>
                    {data.wikiName}.fandom.com
                  </span>
                </div>
                {data.aliases.length > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #8a857a)' }}>
                    <strong>{t.import_fandom_preview_aliases}:</strong> {data.aliases.join(', ')}
                  </div>
                )}
                {data.appearsIn && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #8a857a)' }}>
                    <strong>{t.appearances}:</strong> {data.appearsIn}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem', fontSize: '0.8rem', color: 'var(--text-muted, #8a857a)' }}>
                  <span>✓ {data.characteristics.length} {t.import_fandom_preview_characteristics.toLowerCase()}</span>
                  <span>
                    ✓ {data.voiceActors.length} {t.import_fandom_preview_voices.toLowerCase()}
                    {data.voiceActors.some(v => v.matchedFrom === 'db' || v.matchedFrom === 'anilist') && (
                      <strong style={{ color: 'var(--accent)', marginLeft: '0.25rem' }}>
                        ({data.voiceActors.filter(v => v.matchedFrom === 'db' || v.matchedFrom === 'anilist').length} enlazados)
                      </strong>
                    )}
                  </span>
                  <span>✓ {data.cleanBiography ? 'Biografía detectada' : 'Sin biografía'}</span>
                </div>

                {data.voiceActors.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                    {data.voiceActors.map((va, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border-color)',
                          padding: '0.15rem 0.4rem',
                          borderRadius: '3px',
                          fontSize: '0.72rem',
                        }}
                      >
                        {va.image ? (
                          <img src={va.image} alt="" style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'var(--border-color)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem' }}>
                            {va.name.charAt(0)}
                          </span>
                        )}
                        <span style={{ fontWeight: 600 }}>{va.name}</span>
                        {va.native && <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>({va.native})</span>}
                        <span style={{ fontSize: '0.62rem', padding: '0.05rem 0.25rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '2px' }}>
                          {va.language}
                        </span>
                        {va.matchedFrom && va.matchedFrom !== 'none' && (
                          <span style={{ fontSize: '0.62rem', color: 'var(--accent)', fontWeight: 700 }}>
                            ✓ {va.matchedFrom === 'db' ? 'DB' : 'AniList'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Selector de campos a transferir */}
            <div>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main, #eae6df)', display: 'block', marginBottom: '0.75rem' }}>
                {t.import_fandom_select_fields}
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                <label className="fandom-import-field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedFields.name} onChange={() => toggleField('name')} />
                  <span>{t.import_fandom_preview_name} ({data.name})</span>
                </label>

                <label className="fandom-import-field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedFields.image} onChange={() => toggleField('image')} disabled={!data.imageUrl} />
                  <span>{t.import_fandom_preview_image}</span>
                </label>

                <label className="fandom-import-field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedFields.aliases} onChange={() => toggleField('aliases')} disabled={data.aliases.length === 0} />
                  <span>{t.import_fandom_preview_aliases} ({data.aliases.length})</span>
                </label>

                <label className="fandom-import-field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedFields.characteristics} onChange={() => toggleField('characteristics')} disabled={data.characteristics.length === 0} />
                  <span>{t.import_fandom_preview_characteristics} ({data.characteristics.length})</span>
                </label>

                <label className="fandom-import-field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedFields.biography} onChange={() => toggleField('biography')} disabled={!data.cleanBiography} />
                  <span>{t.import_fandom_preview_bio}</span>
                </label>

                <label className="fandom-import-field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedFields.voiceActors} onChange={() => toggleField('voiceActors')} disabled={data.voiceActors.length === 0} />
                  <span>{t.import_fandom_preview_voices} ({data.voiceActors.length})</span>
                </label>
              </div>
            </div>

            {/* Botones de acción */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem', borderTop: '1px solid var(--border-color, #2d2a24)', paddingTop: '1rem' }}>
              <button
                type="button"
                className="pr-editor-btn pr-editor-btn--secondary"
                onClick={onClose}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="pr-editor-btn pr-editor-btn--primary"
                onClick={handleApply}
              >
                {t.import_fandom_apply}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
