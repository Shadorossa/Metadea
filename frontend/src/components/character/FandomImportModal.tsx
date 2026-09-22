import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { fetchFandomCharacter, type FandomCharacterData } from '../../lib/character/fandomImporter';
import { correlateVoiceActors } from '../../lib/character/voiceActorResolver';
import { getT } from '../../i18n/client';

export interface SelectedImportFields {
  name: boolean;
  nativeName: boolean;
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
  const [imagePickerOpen, setImagePickerOpen] = useState(false);

  const [selectedFields, setSelectedFields] = useState<SelectedImportFields>({
    name: true,
    nativeName: true,
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

  const renderFieldOption = (key: keyof SelectedImportFields, label: string, disabled = false) => (
    <label key={key} className="fandom-import-field-label" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={selectedFields[key]} onChange={() => toggleField(key)} disabled={disabled} />
      <span>{label}</span>
    </label>
  );

  const modalContent = (
    <div className="pr-editor-search-popup" onClick={event => { event.stopPropagation(); onClose(); }}>
      <div
        className="pr-editor-search-popup-content pr-editor-search-popup-content--wide"
        onClick={e => e.stopPropagation()}
        style={{ position: 'relative', padding: 0, paddingRight: '4.5rem', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'row', alignItems: 'stretch' }}
      >
        <div style={{ flex: 1, minWidth: 0, padding: '1.5rem', maxHeight: '85vh', overflowY: 'auto' }}>
        {/* Cabecera del modal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color, #2d2a24)', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent, #7c6af7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main, #eae6df)' }}>
              Importar desde Fandom
            </span>
          </div>
          <div style={{ display: 'flex', flex: 1, minWidth: '260px', gap: '0.5rem', marginLeft: '1rem' }}>
            <input
              type="text"
              placeholder={t.import_fandom_url_ph}
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleFetch(); } }}
              autoFocus
              className="input-dark"
              style={{ flex: 1, minWidth: 0 }}
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
                  <button
                    type="button"
                    onClick={() => setImagePickerOpen(true)}
                    title="Elegir imagen de la wiki"
                    aria-label="Elegir imagen de la wiki"
                    style={{ display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}
                  >
                    <img
                      src={data.imageUrl}
                      alt={data.name}
                      className="fandom-import-preview-img"
                      style={{ width: '100px', height: '130px', objectFit: 'cover', borderRadius: 'var(--radius-sm, 4px)', border: '1px solid var(--border-color)' }}
                    />
                  </button>
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
                {data.nativeName && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #8a857a)' }}>
                    <strong>{t.native_name}:</strong> {data.nativeName}
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
                    {data.voiceActors.some(v => v.matchedFrom === 'db' || v.matchedFrom === 'anilist' || v.matchedFrom === 'tmdb') && (
                      <strong style={{ color: 'var(--accent)', marginLeft: '0.25rem' }}>
                        ({data.voiceActors.filter(v => v.matchedFrom === 'db' || v.matchedFrom === 'anilist' || v.matchedFrom === 'tmdb').length} enlazados)
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
                        {(() => {
                          const m = va.name.match(/^([^(]+)(?:\s*(\([^)]+\)))?$/);
                          const base = m ? m[1].trim() : va.name;
                          const paren = m && m[2] ? m[2].trim() : '';
                          return (
                            <>
                              <span style={{ fontWeight: 600 }}>{base}</span>
                              {paren && (
                                <small style={{ opacity: 0.75, fontSize: '0.75em', fontWeight: 'normal', marginLeft: '0.2rem' }}>
                                  {paren}
                                </small>
                              )}
                            </>
                          );
                        })()}
                        {va.native && <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>({va.native})</span>}
                        <span style={{ fontSize: '0.62rem', padding: '0.05rem 0.25rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '2px' }}>
                          {va.language}
                        </span>
                        {va.matchedFrom && va.matchedFrom !== 'none' && (
                          <span style={{ fontSize: '0.62rem', color: 'var(--accent)', fontWeight: 700 }}>
                            ✓ {va.matchedFrom === 'db' ? 'DB' : va.matchedFrom === 'tmdb' ? 'TMDB' : 'AniList'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Selector de campos a transferir */}
            <div style={{ display: 'flex', alignItems: 'stretch', gap: '0.65rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', flexShrink: 0, fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                Importar
              </span>
              <div style={{ display: 'grid', flex: 1, minWidth: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.75rem' }}>
                <section style={{ minWidth: 0, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm, 4px)', background: 'rgba(255,255,255,0.015)' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.65rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                    Identidad<span aria-hidden="true" style={{ flex: 1, borderTop: '1px solid rgba(255,255,255,0.5)' }} />
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                    {renderFieldOption('name', `${t.import_fandom_preview_name} (${data.name})`)}
                    {renderFieldOption('nativeName', `${t.native_name}${data.nativeName ? ` (${data.nativeName})` : ''}`, !data.nativeName)}
                    {renderFieldOption('image', t.import_fandom_preview_image, !data.imageUrl)}
                  </div>
                </section>

                <section style={{ minWidth: 0, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm, 4px)', background: 'rgba(255,255,255,0.015)' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.65rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                    Contenido<span aria-hidden="true" style={{ flex: 1, borderTop: '1px solid rgba(255,255,255,0.5)' }} />
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                    {renderFieldOption('aliases', `${t.import_fandom_preview_aliases} (${data.aliases.length})`, data.aliases.length === 0)}
                    {renderFieldOption('characteristics', `${t.import_fandom_preview_characteristics} (${data.characteristics.length})`, data.characteristics.length === 0)}
                    {renderFieldOption('biography', t.import_fandom_preview_bio, !data.cleanBiography)}
                  </div>
                </section>

                <section style={{ minWidth: 0, padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm, 4px)', background: 'rgba(255,255,255,0.015)' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.65rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                    Voces<span aria-hidden="true" style={{ flex: 1, borderTop: '1px solid rgba(255,255,255,0.5)' }} />
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                    {renderFieldOption('voiceActors', `${t.import_fandom_preview_voices} (${data.voiceActors.length})`, data.voiceActors.length === 0)}
                  </div>
                </section>
              </div>
            </div>

            {/* Botones de acción */}
            <div style={{ position: 'absolute', top: '50%', right: '1rem', transform: 'translateY(-50%)', display: 'flex', justifyContent: 'flex-end', margin: 0, padding: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <button
                  type="button"
                  className="pr-editor-btn pr-editor-btn--secondary"
                  onClick={onClose}
                  title={t.cancel}
                  aria-label={t.cancel}
                  style={{ minWidth: '42px', minHeight: '38px', padding: '0.45rem' }}
                >
                  <X size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="pr-editor-btn pr-editor-btn--primary"
                  onClick={handleApply}
                  title={t.import_fandom_apply}
                  aria-label={t.import_fandom_apply}
                  style={{ minWidth: '42px', minHeight: '38px', padding: '0.45rem' }}
                >
                  <Check size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}

        {imagePickerOpen && data && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Seleccionar imagen de Fandom"
            onClick={() => setImagePickerOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: '1.5rem', background: 'rgba(0,0,0,0.72)' }}
          >
            <div
              onClick={event => event.stopPropagation()}
              style={{ width: 'min(760px, 100%)', maxHeight: '80vh', overflowY: 'auto', padding: '1.25rem', background: 'var(--bg-card, #1b1b1b)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm, 4px)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <strong>Imágenes de {data.name}</strong>
                <button type="button" onClick={() => setImagePickerOpen(false)} aria-label="Cerrar selector de imágenes" title="Cerrar" className="fandom-import-close-btn">
                  <X size={18} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '0.75rem' }}>
                {data.imageOptions.map(option => (
                  <button
                    type="button"
                    key={`${option.title}:${option.url}`}
                    onClick={() => {
                      setData(current => current ? { ...current, imageUrl: option.url } : current);
                      setImagePickerOpen(false);
                    }}
                    title={option.title}
                    aria-label={`Usar imagen ${option.title}`}
                    style={{ padding: '0.3rem', background: option.url === data.imageUrl ? 'var(--accent-soft)' : 'transparent', border: `1px solid ${option.url === data.imageUrl ? 'var(--accent)' : 'var(--border-color)'}`, borderRadius: 'var(--radius-sm, 4px)', cursor: 'pointer' }}
                  >
                    <img src={option.previewUrl} alt={option.title} loading="lazy" style={{ display: 'block', width: '100%', height: '150px', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
