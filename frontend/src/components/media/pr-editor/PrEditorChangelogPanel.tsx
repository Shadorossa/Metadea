import { useEffect, useState } from 'react';
import { invoke } from '../../../lib/tauri';
import { fetchCommitHistoryForPath, type CatalogFileCommit } from '../../../lib/github/api';
import { catalogFilePath } from '../../../lib/github/catalog-paths';
import { getT } from '../../../i18n/runtime';
import { formatRelativeTime } from '../../../lib/local/save-format';
import { getLocaleCode } from '../../../lib/shared/text/format-date';


interface Props {
  externalId: string;
}

// Small side panel next to the collaborative catalog editor showing this
// specific entry's own GitHub commit history (catalog/<Type>/<id>.json) —
// previously showed lib/shared/community-sync-log.ts's log instead, which
// only ever recorded "a bulk community-catalog sync happened" (the manual
// button in Settings > Entorno, or BaseLayout.astro's once-a-day auto sync),
// the same few entries no matter which media page the editor was opened
// from, not this entry's own history.
export function PrEditorChangelogPanel({ externalId }: Props) {
  const [commits, setCommits] = useState<CatalogFileCommit[] | null>(null);
  const pe = getT().pr_editor;

  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    (async () => {
      const token = await invoke<string | null>('get_github_token').catch(() => null);
      const result = await fetchCommitHistoryForPath(token, catalogFilePath(externalId)).catch(() => []);
      if (!cancelled) setCommits(result);
    })();
    return () => { cancelled = true; };
  }, [externalId]);

  return (
    <div className="pr-editor-changelog-panel" onClick={e => e.stopPropagation()}>
      <span className="pr-editor-changelog-title">{pe.changelog_title}</span>
      {commits === null ? (
        <p className="pr-editor-changelog-empty">{pe.changelog_loading}</p>
      ) : commits.length === 0 ? (
        <p className="pr-editor-changelog-empty">{pe.changelog_empty}</p>
      ) : (
        <ul className="pr-editor-changelog-list">
          {commits.map(c => (
            <li key={c.sha} className="pr-editor-changelog-item">
              <span className="pr-editor-changelog-item-text">
                {c.message}{c.author ? ` — @${c.author}` : ''}
              </span>
              <span className="pr-editor-changelog-item-time">{formatRelativeTime(c.timestamp, Date.now(), getLocaleCode())}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
