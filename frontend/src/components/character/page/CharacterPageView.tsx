// Presentational body of the character page: same DOM structure, ids and
// class names as the former character.astro markup so the existing CSS
// (styles/pages/character.css, media/base.css) applies unchanged.
import type { CharacterPageData } from '../../../lib/character/character-page-data';
import type { CharacterStrings } from '../../../lib/character/character-stat-labels';
import type { CharacterReaction } from '../../../lib/character/character-reactions';
import { attributeUrl } from '../../../lib/character/character-page-urls';
import { sanitizeHtml } from '../../../lib/shared/text/sanitize-html';
import { CharacterAppearances } from './CharacterAppearances';
import { CharacterHeroLeftCol, CharacterHeroRightCol } from './CharacterHero';
import { CharacterStatsList } from './CharacterStats';
import { CharacterVoiceActors } from './CharacterVoiceActors';
import type { CharacterSpoilerView } from './useCharacterSpoilers';
import { SpoilerBanner, SpoilerShield } from '../../spoilers/SpoilerShield';

export interface CharacterPageViewProps {
  t: CharacterStrings;
  data: CharacterPageData;
  avatarUrl: string | null;
  isFavorite: boolean;
  reaction: CharacterReaction | null;
  onToggleFavorite: () => void;
  onReaction: (reaction: CharacterReaction) => void;
  onEditAvatar: () => void;
  onEdit: () => void;
  /** Spoiler shield answers for this character (absent: nothing hidden). */
  spoiler?: CharacterSpoilerView | null;
}

export function CharacterPageView({ t, data, avatarUrl, isFavorite, reaction, onToggleFavorite, onReaction, onEditAvatar, onEdit, spoiler }: CharacterPageViewProps) {
  return (
    <div id="character-content" style={{ display: 'block' }} data-char-key={data.externalId}>
      <div className="character-grid">
        <div className="character-main-content">
          <CharacterHeroLeftCol
            t={t}
            name={data.name}
            avatarUrl={avatarUrl}
            isFavorite={isFavorite}
            reaction={reaction}
            onToggleFavorite={onToggleFavorite}
            onReaction={onReaction}
            onEditAvatar={onEditAvatar}
            avatarSpoiler={spoiler?.hideImage ? { label: spoiler.lateDebutNote, onReveal: spoiler.revealImage } : undefined}
          />

          <CharacterHeroRightCol name={data.name} nameNative={data.nameNative} aliases={data.aliases}>
            {spoiler?.franchiseName && (
              <SpoilerBanner
                franchiseName={spoiler.franchiseName}
                note={spoiler.lateDebutNote}
                onRevealPage={spoiler.revealPage}
                onRevealFranchise={spoiler.revealFranchise}
              />
            )}
          </CharacterHeroRightCol>

          <div className="media-col-synopsis" id="char-bio-section" style={{ display: data.biographyHtml ? 'block' : 'none' }}>
            <div className="media-section-header-row">
              <p className="section-label">{t.biography}</p>
              <div className="media-section-header-line"></div>
            </div>
            {/* Third-party biography markup (AniList/Fandom) — sanitized, never raw. */}
            <SpoilerShield hidden={!!spoiler?.hideBiography} onReveal={spoiler?.revealBiography ?? (() => {})} label={spoiler?.lateDebutNote ?? undefined}>
              <div
                className={`media-description-text${spoiler?.pending ? ' spoiler-shield-pending' : ''}`}
                id="char-description"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.biographyHtml) }}
              />
            </SpoilerShield>
          </div>

          <CharacterAppearances appearances={data.appearances} t={t} />
        </div>

        {/* Always shown so the edit button stays reachable even without data or voice actors. */}
        <div className="media-col-stats character-hero-stats" id="char-stats-card" style={{ display: 'flex' }}>
          <button type="button" className="btn btn--sm btn--secondary char-edit-btn-header" id="char-edit-btn-header" title={t.edit_tooltip} aria-label={t.edit_button} onClick={onEdit}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
          </button>
          <div className="media-section-header-row">
            <p className="section-label">{t.details}</p>
            <div className="media-section-header-line"></div>
            <div id="char-api-link-wrap" style={{ display: data.siteUrl ? 'block' : 'none' }}>
              {data.siteUrl && (
                <a href={attributeUrl(data.siteUrl)} target="_blank" rel="noopener noreferrer" className="media-store-link" title="AniList">
                  <img src="/API/Anilist_logo.png" alt="AniList" className="media-store-icon" />
                </a>
              )}
            </div>
          </div>
          <CharacterStatsList rows={data.statRows} t={t} spoiler={spoiler} />

          <CharacterVoiceActors voiceActors={data.voiceActors} />
        </div>
      </div>
    </div>
  );
}
