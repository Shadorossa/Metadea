// A read-only render of a character proposal, reusing the SAME markup/CSS
// classes as pages/character.astro's own hero+bio+appearances layout (see
// character.css/media.css) instead of a bespoke look — but as a plain React
// component, not a copy of that page's vanilla-JS script: character.astro
// drives its DOM by hand (document.getElementById/innerHTML) and pulls in
// page's DOM script, favorites/reactions and other page controls, none of which
// makes sense for previewing an unmerged proposal that doesn't exist as a
// real character yet. Provider-backed fields are fetched and merged by
// PrPreviewModal; this component only renders the supplied preview state.
import { useEffect, useState } from 'react';
import { getT } from '../../i18n/client';
import { parseCharacterBiography } from '../../lib/character/biography-parser';
import { sanitizeHtml } from '../../lib/shared/sanitize-html';
import { getCatalogEntry, type MediaCatalogEntry } from '../../lib/tauri/catalog';
import type { CharacterEntry } from '../../lib/tauri/characters';
import type { CharacterProposalActor, CharacterProposalAppearance } from '../../lib/github/submitCollaborativeProposal';

export type CharacterPreviewChangeKind = 'added' | 'updated' | 'removed';

export interface CharacterPreviewAppearance extends CharacterProposalAppearance {
  title?: string;
  cover?: string | null;
}

export interface CharacterPreviewChanges {
  fields: Record<string, CharacterPreviewChangeKind>;
  appearances: Record<string, CharacterPreviewChangeKind>;
  actors: Record<string, CharacterPreviewChangeKind>;
}

interface Props {
  character: CharacterEntry;
  appearances: CharacterPreviewAppearance[];
  actors?: CharacterProposalActor[];
  changes?: CharacterPreviewChanges;
}

function diffClass(kind?: CharacterPreviewChangeKind): string {
  return kind ? ` character-preview-diff--${kind}` : '';
}

export function CharacterPreviewCard({ character, appearances, actors = [], changes }: Props) {
  const t = getT().character;
  const { characteristics, cleanBiography } = parseCharacterBiography(character.biography);
  const aliases = (character.aliases_csv ?? '').split(',').map(a => a.trim()).filter(Boolean);

  // Resolving each appearance's title/cover is the one thing here that
  // isn't already sitting in the bundle — same local-catalog lookup the
  // real page falls back to for a work it hasn't fetched live data for.
  const [appearanceMeta, setAppearanceMeta] = useState<Record<string, MediaCatalogEntry | null>>({});
  useEffect(() => {
    let cancelled = false;
    Promise.all(appearances.map(a => getCatalogEntry(a.media_external_id).then(e => [a.media_external_id, e] as const).catch(() => [a.media_external_id, null] as const)))
      .then(results => { if (!cancelled) setAppearanceMeta(Object.fromEntries(results)); });
    return () => { cancelled = true; };
  }, [appearances]);

  return (
    <div className="character-grid">
      <div className="character-main-content">
        <div className="character-hero-left-col">
          <div className={`character-avatar-frame${diffClass(changes?.fields.image_url)}`}>
            <div className="character-avatar-wrap">
              {character.image_url
                ? <img src={character.image_url} alt={character.name} className="character-avatar-img" />
                : <div className="character-avatar-placeholder">{t.no_image}</div>}
            </div>
          </div>
        </div>

        <div className="character-hero-right-col">
          <div className={`character-name-row character-preview-field${diffClass(changes?.fields.name)}`}>
            <h1 className="media-title-main">{character.name}</h1>
          </div>
          {character.name_native && (
            <p className={`media-title-native character-preview-field${diffClass(changes?.fields.name_native)}`}>
              {character.name_native}
            </p>
          )}
          {aliases.length > 0 && (
            <div className={`character-alt-names-wrap character-preview-field${diffClass(changes?.fields.aliases_csv)}`}>
              <div className="character-alt-names">
                {aliases.map(a => <span key={a} className="character-alt-name-tag">{a}</span>)}
              </div>
            </div>
          )}
        </div>

        {cleanBiography && (
          <div className="media-col-synopsis">
            <div className="media-section-header-row">
              <p className="section-label">{t.biography}</p>
              <div className="media-section-header-line" />
            </div>
            <div
              className={`media-description-text character-preview-field${diffClass(changes?.fields.biography)}`}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(cleanBiography) }}
            />
          </div>
        )}

        {appearances.length > 0 && (
          <div className="media-col-related">
            <div className="media-section-header-row">
              <p className="section-label">{t.appearances}</p>
              <div className="media-section-header-line" />
            </div>
            <div className="media-relations-grid">
              {appearances.map(a => {
                const meta = appearanceMeta[a.media_external_id];
                const title = meta?.title_main || a.title || a.media_external_id;
                const cover = meta?.cover_url ?? a.cover ?? undefined;
                return (
                  <a
                    key={a.media_external_id}
                    href={`/media?id=${encodeURIComponent(a.media_external_id)}`}
                    className={`media-relation-card${diffClass(changes?.appearances[a.media_external_id])}`}
                  >
                    {cover && <div className="media-relation-bg-layer"><img src={cover} alt="" /></div>}
                    <div className="media-relation-card-overlay" />
                    <div className="media-relation-card-content">
                      <div className="media-relation-thumb">
                        {cover && <img src={cover} alt={title} loading="lazy" />}
                      </div>
                      <div className="media-relation-info">
                        <span className="media-relation-title">{title}</span>
                      </div>
                    </div>
                    {a.relation_type && <div className="media-relation-type">{a.relation_type}</div>}
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {actors.length > 0 && (
          <div className="media-col-related character-preview-voice-actors">
            <div className="media-section-header-row">
              <p className="section-label">{t.voice_actors}</p>
              <div className="media-section-header-line" />
            </div>
            <div className="media-relations-grid">
              {actors.map(actor => (
                <div
                  key={actor.external_id}
                  className={`media-relation-card${diffClass(changes?.actors[actor.external_id])}`}
                >
                  {actor.image_url && <div className="media-relation-bg-layer"><img src={actor.image_url} alt="" /></div>}
                  <div className="media-relation-card-overlay" />
                  {actor.language && <div className="media-relation-type">{actor.language}</div>}
                  <div className="media-relation-card-content">
                    <div className="media-relation-thumb">
                      {actor.image_url && <img src={actor.image_url} alt={actor.name || ''} loading="lazy" />}
                    </div>
                    <div className="media-relation-info">
                      <span className="media-relation-title">{actor.name || actor.external_id}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {characteristics.length > 0 && (
        <div className="media-col-stats character-hero-stats">
          <div className="media-section-header-row">
            <p className="section-label">{t.details}</p>
            <div className="media-section-header-line" />
          </div>
          <div className="media-stats-list character-preview-stats-list">
            {characteristics.map((stat, i) => (
              <div className="media-stat-item" key={`${stat.label}-${i}`}>
                <div className="media-stat-main-row">
                  <span className="media-stat-label">{stat.label}</span>
                  <div className="media-stat-value">
                    <div className="media-stat-val-main" dangerouslySetInnerHTML={{ __html: sanitizeHtml(stat.value) }} />
                  </div>
                </div>
                <div className="media-stat-divider-row">
                  <div className="media-stat-divider-line" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
