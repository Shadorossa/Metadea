// "Actualmente" on Home — what you're currently watching/reading/playing,
// grouped by media type, capped to 5 per type so one type with 40 entries
// doesn't push everything else off-screen.
import { useEffect, useState } from 'react';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { isInProgressStatus, getTypeLabel } from '../../lib/constants/media';
import { wrapAssetUrl } from '../../lib/tauri';
import type { LibraryEntry, MediaCatalogEntry } from '../../lib/tauri';
import { typeIconMap } from '../../lib/shared/icon-strings';

const TYPE_ICON = typeIconMap(14);
const MAX_PER_TYPE = 5;

interface TypeGroup {
  type:  string;
  items: Array<{ entry: LibraryEntry; meta?: MediaCatalogEntry }>;
}

export function CurrentlySection() {
  const [groups, setGroups] = useState<TypeGroup[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCachedLibraryAndCatalog().then(({ items, catalog }) => {
      if (cancelled) return;
      const catalogMap = new Map(catalog.map(c => [c.external_id, c]));
      const inProgress = items.filter(i => isInProgressStatus(i.status));

      const byType = new Map<string, LibraryEntry[]>();
      for (const entry of inProgress) {
        const list = byType.get(entry.type) ?? [];
        list.push(entry);
        byType.set(entry.type, list);
      }

      const result: TypeGroup[] = [...byType.entries()].map(([type, entries]) => ({
        type,
        items: entries
          // Most recently touched first, same "what's active right now" intent as progress.
          .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
          .slice(0, MAX_PER_TYPE)
          .map(entry => ({ entry, meta: catalogMap.get(entry.external_id) })),
      }));
      setGroups(result);
    });
    return () => { cancelled = true; };
  }, []);

  if (!groups || groups.length === 0) return null;

  return (
    <div className="home-currently-groups">
      {groups.map(group => (
        <div className="home-currently-group" key={group.type}>
          <div className="home-currently-group-label">
            <span dangerouslySetInnerHTML={{ __html: TYPE_ICON[group.type] ?? '' }} />
            <span>{getTypeLabel(group.type)}</span>
          </div>
          <div className="home-currently-row">
            {group.items.map(({ entry, meta }) => (
              <a
                key={entry.external_id}
                className="home-currently-item"
                href={`/media?id=${encodeURIComponent(entry.external_id)}`}
                title={meta?.title_main ?? entry.external_id}
              >
                {meta?.cover_url
                  ? <img className="home-currently-cover" src={wrapAssetUrl(meta.cover_url)} alt="" loading="lazy" />
                  : <div className="home-currently-cover home-currently-cover--empty" />}
                <p className="home-currently-title">{meta?.title_main ?? entry.external_id}</p>
              </a>
            ))}
            {/* Keeps every row the same width (5 slots) regardless of how
                many in-progress works that type actually has right now. */}
            {Array.from({ length: MAX_PER_TYPE - group.items.length }).map((_, i) => (
              <div className="home-currently-item home-currently-item--empty" key={`empty-${i}`}>
                <div className="home-currently-cover home-currently-cover--empty" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
