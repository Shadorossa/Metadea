import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { MediaEpisode } from '../../../lib/tauri/episodes';
import type { Translations } from '../../../i18n/index';

interface Props {
  pe: Translations['pr_editor'];
  entry: MediaCatalogEntry;
  episodePreview: MediaEpisode[];
  episodePreviewLoading: boolean;
  episodeSourceTitle: string;
  onSelectSource: () => void;
  onResetSource: () => void;
}

// Read-only preview of the episode list the current episode source (TMDB
// mapping, or the automatic lookup) resolves to, plus the source picker row.
export function PrEditorEpisodesSection({ pe, entry, episodePreview, episodePreviewLoading, episodeSourceTitle, onSelectSource, onResetSource }: Props) {
  return (
    <div className="pr-editor-section">
      <div className="pr-editor-source-mapping-row">
        <span>{pe.source_episodes} {episodeSourceTitle || (episodePreviewLoading ? pe.loading_source : '—')}</span>
        <button type="button" className="pr-editor-add-btn" onClick={onSelectSource}>{pe.select_series}</button>
        {entry.episode_source_id && <button type="button" className="pr-editor-add-btn" onClick={onResetSource}>{pe.reset}</button>}
      </div>
      <div className="media-relations-grid pr-editor-episode-preview-grid" aria-label={pe.episode_list_label}>
        {episodePreview.map((episode, index) => (
          <div className="media-relation-card media-relation-card--static" key={`${episode.source_key ?? episode.external_id}-${episode.season_number}-${episode.episode_number}-${index}`}>
            <div className="media-relation-bg-layer media-episode-bg-layer">
              {episode.cover_url && <img src={episode.cover_url} alt="" loading="lazy" />}
            </div>
            <div className="media-relation-card-overlay" />
            <span className="media-relation-type">
              {episode.season_number > 0
                ? `S${String(episode.season_number).padStart(2, '0')}E${String(episode.episode_number).padStart(2, '0')}`
                : episode.episode_number < 0 ? `Sp${-episode.episode_number}` : `#${episode.episode_number}`}
            </span>
            <div className="media-relation-card-content">
              <div className="media-relation-info">
                <span className="media-relation-title">{episode.name || pe.episode_n.replace('{number}', String(episode.episode_number))}</span>
              </div>
            </div>
          </div>
        ))}
        {episodePreviewLoading && <div className="pr-editor-search-loading pr-editor-episode-preview-state">{pe.loading_episodes}</div>}
        {!episodePreviewLoading && episodePreview.length === 0 && <div className="pr-editor-search-empty pr-editor-episode-preview-state">{pe.no_episodes_available}</div>}
      </div>
    </div>
  );
}
