import React, { useState, useEffect } from 'react';
import {
  getAniListToken,
  pickFolder,
  scanAnimeFolder,
  saveAnimeFolder,
  getAnimeFolder,
  playFileWithVlc,
} from '../../lib/tauri';
import { getWatchingAnime, getPlanToWatchAnime, updateAniListProgress, type AnimeWatchEntry } from '../../lib/anilist/watching';

export function AnimeLocal() {
  const [watching, setWatching] = useState<AnimeWatchEntry[]>([]);
  const [planToWatch, setPlanToWatch] = useState<AnimeWatchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAnime, setSelectedAnime] = useState<AnimeWatchEntry | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);

  useEffect(() => {
    loadAniListAnimes();
  }, []);

  async function loadAniListAnimes() {
    try {
      setLoading(true);
      const token = await getAniListToken();
      if (!token) {
        alert('No AniList token found');
        return;
      }

      const [w, p] = await Promise.all([
        getWatchingAnime(token),
        getPlanToWatchAnime(token),
      ]);
      setWatching(w);
      setPlanToWatch(p);
    } catch (err) {
      console.error('Error loading AniList:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectAnime(anime: AnimeWatchEntry) {
    setSelectedAnime(anime);
    setSelectedFolder(null);
    setFileCount(0);

    const saved = await getAnimeFolder(anime.mediaId);
    if (saved) {
      setSelectedFolder(saved.folder_path);
      setFileCount(saved.episode_count);
    }
  }

  async function handleChooseFolder() {
    const folder = await pickFolder();
    if (!folder || !selectedAnime) return;

    const files = await scanAnimeFolder(folder);
    setSelectedFolder(folder);
    setFileCount(files.length);
  }

  async function handleSaveFolder() {
    if (!selectedAnime || !selectedFolder) return;

    await saveAnimeFolder(selectedAnime.mediaId, selectedFolder, fileCount);
    alert('Folder saved');
  }

  async function handlePlayEpisode(episodeNum: number) {
    if (!selectedAnime || !selectedFolder) return;

    const files = await scanAnimeFolder(selectedFolder);
    if (episodeNum > files.length) {
      alert('Episode file not found');
      return;
    }

    const file = files[episodeNum - 1];
    const filePath = `${selectedFolder}/${file}`;

    try {
      // Launch VLC
      await playFileWithVlc(filePath);

      // Update in AniList
      const token = await getAniListToken();
      if (token) {
        let newStatus: string | undefined;
        if (selectedAnime.status === 'PLANNING') {
          newStatus = 'CURRENT';
        } else if (episodeNum === selectedAnime.totalEpisodes) {
          newStatus = 'COMPLETED';
        }

        await updateAniListProgress(token, selectedAnime.mediaId, episodeNum, newStatus);
      }
    } catch (err) {
      console.error('Error playing episode:', err);
    }
  }

  const allAnimes = [...watching, ...planToWatch];
  const episodesMatch = selectedAnime && selectedFolder && fileCount === selectedAnime.totalEpisodes;

  return (
    <div style={{ padding: '1.5rem', maxWidth: '900px' }}>
      {!selectedAnime ? (
        <div>
          <div style={{ marginBottom: '2rem' }}>
            <h3>Watching ({watching.length})</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
              {watching.map(anime => (
                <button
                  key={anime.mediaId}
                  onClick={() => handleSelectAnime(anime)}
                  style={{
                    padding: '1rem',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  {anime.cover && <img src={anime.cover} alt={anime.title} style={{ width: '100%', borderRadius: '4px', marginBottom: '0.5rem' }} />}
                  <p style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{anime.title}</p>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {anime.currentProgress}/{anime.totalEpisodes} eps
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3>Plan to Watch ({planToWatch.length})</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
              {planToWatch.map(anime => (
                <button
                  key={anime.mediaId}
                  onClick={() => handleSelectAnime(anime)}
                  style={{
                    padding: '1rem',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'center',
                    opacity: 0.7,
                  }}
                >
                  {anime.cover && <img src={anime.cover} alt={anime.title} style={{ width: '100%', borderRadius: '4px', marginBottom: '0.5rem' }} />}
                  <p style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{anime.title}</p>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {anime.totalEpisodes} eps
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '8px' }}>
          <button onClick={() => setSelectedAnime(null)} style={{ marginBottom: '1rem' }}>
            ← Back
          </button>

          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem' }}>
            {selectedAnime.cover && <img src={selectedAnime.cover} alt={selectedAnime.title} style={{ width: '120px', height: 'auto', borderRadius: '8px' }} />}
            <div>
              <h3>{selectedAnime.title}</h3>
              <p>Total episodes: {selectedAnime.totalEpisodes}</p>
              <p>Current progress: {selectedAnime.currentProgress}</p>
              <p>Status: {selectedAnime.status}</p>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: '8px' }}>
            <p style={{ marginBottom: '1rem' }}>
              {selectedFolder ? `Folder: ${selectedFolder}` : 'No folder selected'}
            </p>
            {selectedFolder && (
              <p style={{ marginBottom: '1rem' }}>
                Files found: {fileCount} / Expected: {selectedAnime.totalEpisodes}
                {episodesMatch ? ' ✓' : ' ✗'}
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn--sm btn--secondary" onClick={handleChooseFolder}>
                📁 Choose Folder
              </button>
              {selectedFolder && (
                <button className="btn btn--sm btn--primary" onClick={handleSaveFolder}>
                  Save
                </button>
              )}
            </div>
          </div>

          {episodesMatch && (
            <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: '8px' }}>
              <h4>Episodes</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.5rem' }}>
                {Array.from({ length: selectedAnime.totalEpisodes }, (_, i) => i + 1).map(ep => (
                  <button
                    key={ep}
                    onClick={() => handlePlayEpisode(ep)}
                    style={{
                      padding: '0.5rem',
                      background: ep <= selectedAnime.currentProgress ? 'var(--accent)' : 'var(--bg-elevated)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {ep}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
