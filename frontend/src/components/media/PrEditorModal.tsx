import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  getCatalogEntry, saveCatalogEntry,
  getCachedSaga, saveCachedSaga,
  getMediaRelations, saveMediaRelations,
  searchCatalog,
  getAllCatalogEntries,
} from '../../lib/tauri/catalog';
import type { MediaCatalogEntry, DbMediaRelation } from '../../lib/tauri/catalog';
import type { SagaEntry } from '../../lib/anilist/saga';

const BUNDLE_RELATION_TYPES = ['EPISODE', 'UPDATE'];

interface BundledRelation {
  external_id: string;
  type: 'episode' | 'update';
}

interface SagaEntry_UI {
  external_id: string;
}

interface Props {
  externalId: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface SearchResult {
  external_id: string;
  title_main: string | null;
  cover_url: string | null;
}

function MediaSearchPopup({ onSelect, onClose }: { onSelect: (external_id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);

    // First try local catalog
    searchCatalog(query)
      .then(entries => {
        const localResults: SearchResult[] = entries.map(e => ({
          external_id: e.external_id,
          title_main: e.title_main,
          cover_url: e.cover_url
        }));
        setResults(localResults.slice(0, 30));
      })
      .catch(() => setResults([]))
      .finally(() => setIsLoading(false));
  }, [query]);

  return (
    <div className="pr-editor-search-popup" onClick={onClose}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        <input
          type="text"
          placeholder="Search by title or ID (e.g. anime:12345)..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
          className="pr-editor-search-input"
        />
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">Searching...</div>}
          {!isLoading && results.length === 0 && query && (
            <div className="pr-editor-search-empty">No results</div>
          )}
          <div className="pr-editor-search-grid">
            {results.map(r => (
              <button
                key={r.external_id}
                type="button"
                className="pr-editor-search-result-card"
                onClick={() => {
                  onSelect(r.external_id);
                  onClose();
                }}
              >
                {r.cover_url && (
                  <img src={r.cover_url} alt="" className="pr-editor-search-result-cover" />
                )}
                <div className="pr-editor-search-result-info">
                  <div className="pr-editor-search-result-id">{r.external_id}</div>
                  <div className="pr-editor-search-result-title">{r.title_main || '—'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SlotInputProps {
  label: string;
  value: string | null | undefined;
  onChange: (newValue: string | null) => void;
  placeholder?: string;
  /** Render each item as an image thumbnail (loaded from the item itself as
   *  a URL) instead of a plain text pill — used for banner URLs, where the
   *  raw string is meaningless to a reviewer but the image it points to
   *  isn't. */
  preview?: boolean;
  /** Span both grid columns instead of sharing a row with another field —
   *  only worth it for image-preview lists (thumbnails need the room); plain
   *  tag lists default to half-width so two of them share a row instead of
   *  each claiming a full row and stacking the whole form tall. */
  fullWidth?: boolean;
}

function SlotInput({ label, value, onChange, placeholder, preview, fullWidth }: SlotInputProps) {
  const items = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const [inputVal, setInputVal] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = inputVal.trim();
      if (val && !items.includes(val)) {
        const next = [...items, val].join(',');
        onChange(next);
      }
      setInputVal('');
    } else if (e.key === 'Backspace' && !inputVal && items.length > 0) {
      const next = items.slice(0, -1).join(',');
      onChange(next || null);
    }
  };

  const handleRemove = (itemToRemove: string) => {
    const next = items.filter(i => i !== itemToRemove).join(',');
    onChange(next || null);
  };

  return (
    <div className={`pr-editor-field${fullWidth ? ' pr-editor-field--full' : ''}`}>
      <label>{label}</label>
      <div className={`pr-editor-slots-box${preview ? ' pr-editor-slots-box--preview' : ''}`}>
        {items.map(item => (
          preview ? (
            <div key={item} className="pr-editor-image-slot">
              <div className="pr-editor-image-slot-media">
                <img src={item} alt="" className="pr-editor-image-slot-img" />
                <button type="button" className="pr-editor-image-slot-remove" onClick={() => handleRemove(item)}>×</button>
              </div>
              <span className="pr-editor-image-slot-url" title={item}>{item}</span>
            </div>
          ) : (
            <span key={item} className="pr-editor-slot-pill">
              {item}
              <button type="button" className="pr-editor-slot-remove" onClick={() => handleRemove(item)}>×</button>
            </span>
          )
        ))}
        <input
          type="text"
          className="pr-editor-slot-input"
          placeholder={placeholder || 'Press Enter or comma to add...'}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}

export function PrEditorModal({ externalId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [entry, setEntry] = useState<MediaCatalogEntry | null>(null);
  const [sagaEntries, setSagaEntries] = useState<SagaEntry_UI[]>([]);
  const [bundledRelations, setBundledRelations] = useState<BundledRelation[]>([]);
  const [otherRelations, setOtherRelations] = useState<DbMediaRelation[]>([]);
  const [searchPopupMode, setSearchPopupMode] = useState<'saga' | 'bundled' | null>(null);

  useEffect(() => {
    getCatalogEntry(externalId)
      .then(res => {
        if (res) {
          setEntry(res);
        } else {
          setEntry({
            id: '',
            external_id: externalId,
            type: externalId.split(':')[0],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      })
      .catch(err => {
        console.error('Failed to get catalog entry:', err);
        setErrorMsg('Error reading local data');
      })
      .finally(() => setLoading(false));

    getCachedSaga(externalId)
      .then(saga => {
        const ids = (saga || []).map(s => ({ external_id: s.externalId })).filter(s => s.external_id !== externalId);
        setSagaEntries(ids);
      })
      .catch(() => setSagaEntries([]));

    getMediaRelations(externalId)
      .then(rels => {
        const bundled = (rels || []).filter(r => BUNDLE_RELATION_TYPES.includes(r.relation_type));
        const others = (rels || []).filter(r => !BUNDLE_RELATION_TYPES.includes(r.relation_type));
        setBundledRelations(bundled.map(r => ({
          external_id: r.related_media_external_id,
          type: r.relation_type === 'UPDATE' ? 'update' : 'episode',
        })));
        setOtherRelations(others);
      })
      .catch(() => {
        setBundledRelations([]);
        setOtherRelations([]);
      });
  }, [externalId]);

  const addSagaEntry = (external_id: string) => {
    if (!sagaEntries.find(s => s.external_id === external_id)) {
      setSagaEntries([...sagaEntries, { external_id }]);
    }
  };

  const removeSagaEntry = (external_id: string) => {
    setSagaEntries(sagaEntries.filter(s => s.external_id !== external_id));
  };

  const addBundledRelation = (external_id: string) => {
    if (!bundledRelations.find(r => r.external_id === external_id)) {
      setBundledRelations([...bundledRelations, { external_id, type: 'episode' }]);
    }
  };

  const updateBundledRelation = (index: number, patch: Partial<BundledRelation>) => {
    setBundledRelations(bundledRelations.map((r, i) => i === index ? { ...r, ...patch } : r));
  };

  const removeBundledRelation = (index: number) => {
    setBundledRelations(bundledRelations.filter((_, i) => i !== index));
  };

  const handleChange = (field: keyof MediaCatalogEntry, value: any) => {
    if (!entry) return;
    setEntry({
      ...entry,
      [field]: value === '' ? null : value
    });
  };

  const handleSubmit = async () => {
    if (!entry) return;
    setSubmitting(true);
    setErrorMsg('');
    setStatusMsg('Checking GitHub token...');

    try {
      const token = await invoke<string | null>('get_github_token').catch(() => null);
      if (!token) {
        throw new Error('Please log in with GitHub in Metadea Settings to submit proposals.');
      }

      await saveCatalogEntry(entry);

      const sagaIds = sagaEntries.map(s => s.external_id).filter(id => id !== externalId);
      if (sagaIds.length > 0) {
        const sagaEntries: SagaEntry[] = [
          {
            externalId,
            title: entry.title_main || externalId,
            cover: entry.cover_url || null,
            format: entry.format || null,
            mediaType: entry.type,
            year: entry.release_year ?? null,
            month: entry.release_month ?? null,
            day: entry.release_day ?? null,
          },
          ...sagaIds.map(id => ({
            externalId: id,
            title: id,
            cover: null,
            format: null,
            mediaType: id.split(':')[0] || 'anime',
            year: null,
            month: null,
            day: null,
          })),
        ];
        await saveCachedSaga(sagaEntries).catch(err => console.error('Failed to save saga:', err));
      }

      const bundledDbRelations: DbMediaRelation[] = bundledRelations
        .filter(r => r.external_id.trim())
        .map(r => ({
          related_media_external_id: r.external_id.trim(),
          relation_type: r.type.toUpperCase(),
          type_label: r.type === 'update' ? 'Update' : 'Episode',
          title: r.external_id.trim(),
          cover: null,
        }));
      await saveMediaRelations(externalId, [...otherRelations, ...bundledDbRelations])
        .catch(err => console.error('Failed to save relations:', err));

      if (onSaved) onSaved();

      setStatusMsg('Fetching GitHub profile...');
      const user = await invoke<any>('get_github_user_profile', { token });
      const username = user.login;

      const jsonContent = JSON.stringify(entry, null, 2);
      const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));
      const repoOwner = 'Shadorossa';
      const repoName = 'Metadea';
      const filePath = `database/${externalId.replace(':', '-')}.json`;
      const branchName = `proposal-${externalId.replace(':', '-')}-${username}`;

      const isOwner = username.toLowerCase() === repoOwner.toLowerCase();
      let targetRepoOwner = repoOwner;

      if (!isOwner) {
        setStatusMsg('Creating repository fork...');
        const forkRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/forks`, {
          method: 'POST',
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (!forkRes.ok && forkRes.status !== 202) {
          throw new Error('Failed to create repository fork on GitHub.');
        }
        targetRepoOwner = username;
        setStatusMsg('Waiting for GitHub to prepare the fork (3s)...');
        await new Promise(r => setTimeout(r, 3000));
      }

      setStatusMsg('Getting main branch references...');
      const mainBranchRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/main`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (!mainBranchRes.ok) {
        throw new Error('Failed to obtain main branch reference.');
      }
      const mainBranchData = await mainBranchRes.json();
      const mainSha = mainBranchData.object.sha;

      setStatusMsg('Creating proposal branch...');
      const createBranchRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${repoName}/git/refs`, {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: mainSha
        })
      });

      if (!createBranchRes.ok && createBranchRes.status !== 422) {
        throw new Error('Failed to create proposal branch.');
      }

      let fileSha: string | undefined;
      const fileCheckRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${repoName}/contents/${filePath}?ref=${branchName}`, {
        headers: { 'Authorization': `token ${token}` }
      });
      if (fileCheckRes.ok) {
        const fileCheckData = await fileCheckRes.json();
        fileSha = fileCheckData.sha;
      }

      setStatusMsg('Uploading data to GitHub...');
      const commitRes = await fetch(`https://api.github.com/repos/${targetRepoOwner}/${repoName}/contents/${filePath}`, {
        method: 'PUT',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: `Update catalog entry for ${entry.title_main || externalId}`,
          content: base64Content,
          branch: branchName,
          sha: fileSha
        })
      });

      if (!commitRes.ok) {
        throw new Error('Failed to commit JSON file to GitHub.');
      }

      if (!isOwner) {
        setStatusMsg('Opening Pull Request...');
        const prRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
          method: 'POST',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: `[Proposal] Catalog data for ${entry.title_main || externalId}`,
            head: `${username}:${branchName}`,
            base: 'main',
            body: `Proposal submitted from Metadea desktop application by user @${username}.\n\nUpdates metadata file: ${entry.title_main || externalId} (${externalId}).`
          })
        });

        if (!prRes.ok) {
          const prData = await prRes.json();
          if (prData.errors?.[0]?.message?.includes('A pull request already exists')) {
            setStatusMsg('Proposal uploaded! An active Pull Request already exists.');
          } else {
            throw new Error('Failed to open Pull Request.');
          }
        } else {
          setStatusMsg('Proposal submitted successfully!');
        }
      } else {
        setStatusMsg('Data uploaded directly to proposal branch!');
      }

      setTimeout(() => {
        onClose();
      }, 1500);

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error communicating with GitHub API');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="pr-editor-overlay">
        <div className="pr-editor-modal pr-editor-modal--loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!entry) return null;

  return createPortal(
    <div className="pr-editor-overlay" onClick={onClose}>
      <div className="pr-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-header">
          <span className="pr-editor-title">Edit Collaborative Catalog Entry</span>
          <span className="pr-editor-subtitle">ID: {externalId}</span>
        </div>

        <div className="pr-editor-body">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error">{errorMsg}</div>}
          {statusMsg && <div className="pr-editor-alert pr-editor-alert--status">{statusMsg}</div>}

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Titles &amp; Synopsis</span>
            <div className="pr-editor-form-grid">
              <div className="pr-editor-field">
                <label>Main Title</label>
                <input type="text" value={entry.title_main || ''} onChange={e => handleChange('title_main', e.target.value)} />
              </div>

              <div className="pr-editor-field">
                <label>Romaji Title</label>
                <input type="text" value={entry.title_romaji || ''} onChange={e => handleChange('title_romaji', e.target.value)} />
              </div>

              <div className="pr-editor-field">
                <label>Native Title</label>
                <input type="text" value={entry.title_native || ''} onChange={e => handleChange('title_native', e.target.value)} />
              </div>

              <div className="pr-editor-field pr-editor-field--full">
                <label>Synopsis / Description</label>
                <textarea rows={4} value={entry.synopsis || ''} onChange={e => handleChange('synopsis', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Images</span>
            <div className="pr-editor-field-row">
              <div className="pr-editor-field pr-editor-field--fixed">
                <label>Cover URL</label>
                <div className="pr-editor-cover-row">
                  {entry.cover_url && (
                    <img src={entry.cover_url} alt="" className="pr-editor-cover-preview" />
                  )}
                  <input type="text" value={entry.cover_url || ''} onChange={e => handleChange('cover_url', e.target.value)} />
                </div>
              </div>

              <SlotInput label="Banner URLs" value={entry.banners_csv} onChange={v => handleChange('banners_csv', v)} preview />
            </div>
          </div>

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Classification</span>
            <div className="pr-editor-form-grid">
              <SlotInput label="Genres" value={entry.genres_csv} onChange={v => handleChange('genres_csv', v)} />
              <SlotInput label="Themes / Tags" value={entry.genres_tag_csv} onChange={v => handleChange('genres_tag_csv', v)} />
              <SlotInput label="Platforms" value={entry.platforms_csv} onChange={v => handleChange('platforms_csv', v)} />
              <SlotInput label="Companies / Studios" value={entry.companies_cache_csv} onChange={v => handleChange('companies_cache_csv', v)} />
              <SlotInput label="Authors / Staff" value={entry.authors_csv} onChange={v => handleChange('authors_csv', v)} />
            </div>
          </div>

          <div className="pr-editor-section">
            <span className="pr-editor-section-title">Release &amp; Progress</span>
            <div className="pr-editor-field-row">
              <div className="pr-editor-subgroup">
                <span className="pr-editor-subgroup-label">Release Date</span>
                <div className="pr-editor-subgroup-fields">
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Year</label>
                    <input type="number" value={entry.release_year || ''} onChange={e => handleChange('release_year', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Month</label>
                    <input type="number" value={entry.release_month || ''} onChange={e => handleChange('release_month', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Day</label>
                    <input type="number" value={entry.release_day || ''} onChange={e => handleChange('release_day', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                </div>
              </div>

              <div className="pr-editor-subgroup-divider" />

              <div className="pr-editor-subgroup">
                <span className="pr-editor-subgroup-label">Totals</span>
                <div className="pr-editor-subgroup-fields">
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Episodes / Chapters</label>
                    <input type="number" value={entry.total_count || ''} onChange={e => handleChange('total_count', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                  <div className="pr-editor-field pr-editor-field--small">
                    <label>Seasons / Volumes</label>
                    <input type="number" value={entry.total_count_2 || ''} onChange={e => handleChange('total_count_2', e.target.value ? parseInt(e.target.value, 10) : null)} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pr-editor-section pr-editor-section--row">
            <div className="pr-editor-subsection">
              <label className="pr-editor-subsection-label">Saga</label>
              <div className="pr-editor-tag-list">
                {sagaEntries.map(s => (
                  <span key={s.external_id} className="pr-editor-tag">
                    {s.external_id}
                    <button type="button" className="pr-editor-tag-remove" onClick={() => removeSagaEntry(s.external_id)}>×</button>
                  </span>
                ))}
              </div>
              <button type="button" className="pr-editor-add-btn" onClick={() => setSearchPopupMode('saga')}>+ Add</button>
            </div>

            <div className="pr-editor-subsection">
              <label className="pr-editor-subsection-label">Bundled In</label>
              <div className="pr-editor-tag-list">
                {bundledRelations.map((r, i) => (
                  <span key={i} className="pr-editor-tag pr-editor-tag--with-type">
                    {r.external_id}
                    <select
                      value={r.type}
                      onChange={e => updateBundledRelation(i, { type: e.target.value as BundledRelation['type'] })}
                      className="pr-editor-tag-type"
                    >
                      <option value="episode">Episode</option>
                      <option value="update">Update</option>
                    </select>
                    <button type="button" className="pr-editor-tag-remove" onClick={() => removeBundledRelation(i)}>×</button>
                  </span>
                ))}
              </div>
              <button type="button" className="pr-editor-add-btn" onClick={() => setSearchPopupMode('bundled')}>+ Add</button>
            </div>
          </div>
        </div>

        <div className="pr-editor-footer">
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Proposal'}
          </button>
        </div>
      </div>

      {searchPopupMode === 'saga' && (
        <MediaSearchPopup
          onSelect={id => addSagaEntry(id)}
          onClose={() => setSearchPopupMode(null)}
        />
      )}

      {searchPopupMode === 'bundled' && (
        <MediaSearchPopup
          onSelect={id => addBundledRelation(id)}
          onClose={() => setSearchPopupMode(null)}
        />
      )}
    </div>,
    document.body
  );
}
