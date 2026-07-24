import { getCommunitySyncLog } from '../../lib/shared/community-sync-log';
import { getT } from '../../i18n/client';

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

// Small side panel next to the collaborative catalog editor showing the
// last few community-catalog syncs (manual button in Settings > Entorno,
// or BaseLayout.astro's own once-a-day auto sync) — see
// lib/shared/community-sync-log.ts for where these entries come from.
// Read once at mount: this panel doesn't need to react to a sync that
// happens while the editor itself is open, since nothing in this modal
// triggers one.
export function PrEditorChangelogPanel() {
  const log = getCommunitySyncLog();
  const pe = getT().pr_editor;

  return (
    <div className="pr-editor-changelog-panel" onClick={e => e.stopPropagation()}>
      <span className="pr-editor-changelog-title">{pe.changelog_title}</span>
      {log.length === 0 ? (
        <p className="pr-editor-changelog-empty">{pe.changelog_empty}</p>
      ) : (
        <ul className="pr-editor-changelog-list">
          {log.map((entry, i) => (
            <li key={i} className="pr-editor-changelog-item">
              <span className="pr-editor-changelog-item-text">
                {entry.changes > 0
                  ? `Se descargaron nuevos datos de la comunidad`
                  : 'Ya estabas al día'}
              </span>
              <span className="pr-editor-changelog-item-time">{relativeTime(entry.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
