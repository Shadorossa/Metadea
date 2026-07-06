import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { getCatalogEntry, saveCatalogEntry } from '../../lib/tauri/catalog';
import type { MediaCatalogEntry } from '../../lib/tauri/catalog';

interface Props {
  externalId: string;
  onClose: () => void;
  onSaved?: () => void;
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
  }, [externalId]);

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
            <div className="pr-editor-form-grid">
              <div className="pr-editor-field">
                <label>Cover URL</label>
                <div className="pr-editor-cover-row">
                  {entry.cover_url && (
                    <img src={entry.cover_url} alt="" className="pr-editor-cover-preview" />
                  )}
                  <input type="text" value={entry.cover_url || ''} onChange={e => handleChange('cover_url', e.target.value)} />
                </div>
              </div>

              <SlotInput label="Banner URLs" value={entry.banners_csv} onChange={v => handleChange('banners_csv', v)} preview fullWidth />
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
    </div>,
    document.body
  );
}
