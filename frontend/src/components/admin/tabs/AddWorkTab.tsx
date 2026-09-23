import { useState } from 'react';
import type { Translations } from '../../../i18n/index';
import { getCatalogEntry, saveCatalogEntry } from '../../../lib/tauri/catalog';
import { fetchMediaData } from '../../../lib/media/media-page-data';
import { AdminAddSearch } from '../AdminAddSearch';
import type { EditorRequest } from '../admin-panel-types';

interface Props {
  t: Translations['admin'];
  openEditor: (request: EditorRequest) => void;
}

// "Add work" source: pick a title from the live providers, make sure it has a
// local catalog row, then hand it to the shared editor as a new proposal.
export function AddWorkTab({ t, openEditor }: Props) {
  const [addBusy, setAddBusy] = useState(false);

  return (
    <>
      {addBusy && <p className="catalog-admin-status">{t.add_fetching}</p>}
      <AdminAddSearch
        onSelect={async ({ externalId, title, coverUrl }) => {
          if (addBusy) return;
          // Only fetch/persist anything when this id has never been
          // cataloged before — an existing row may carry curated edits
          // (e.g. a manually-corrected release date) that a live refetch
          // must never reset back to whatever the API currently says.
          const existing = await getCatalogEntry(externalId).catch(() => null);
          if (!existing) {
            setAddBusy(true);
            try {
              // Same live fetch+map+persist every normal media page does on
              // first visit (fetchMediaData → provider mapper →
              // persistToCatalog) — gets synopsis/dates/genres/platforms/
              // authors/etc, not just title+cover, before opening the editor.
              const full = await fetchMediaData(externalId).catch(() => null);
              if (!full) {
                const now = new Date().toISOString();
                await saveCatalogEntry({
                  id: '',
                  external_id: externalId,
                  type: externalId.split(':')[0],
                  format: null,
                  source: externalId.startsWith('game:') || externalId.startsWith('vnovel:') ? 'igdb'
                    : externalId.startsWith('anime:') || externalId.startsWith('manga:') || externalId.startsWith('lnovel:') ? 'anilist'
                    : externalId.startsWith('movie:') || externalId.startsWith('series:') ? 'tmdb'
                    : externalId.startsWith('book:') ? 'openlibrary'
                    : externalId.startsWith('comic:') ? 'comicvine'
                    : null,
                  title_main: title,
                  title_romaji: null,
                  title_native: null,
                  cover_url: coverUrl,
                  release_year: null,
                  release_month: null,
                  release_day: null,
                  score_global: null,
                  created_at: now,
                  updated_at: now,
                }).catch(console.error);
              }
            } finally {
              setAddBusy(false);
            }
          }
          openEditor({ externalId });
        }}
      />
    </>
  );
}
