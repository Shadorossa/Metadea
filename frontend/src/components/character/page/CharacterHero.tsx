import type { ReactNode } from 'react';
import type { CharacterAlias } from '../../../lib/character/character-aliases';
import type { CharacterStrings } from '../../../lib/character/character-stat-labels';
import type { CharacterReaction } from '../../../lib/character/character-reactions';
import { attributeUrl } from '../../../lib/character/character-page-urls';
import { CharacterActionRow } from './CharacterActionRow';
import { SpoilerChip } from '../../spoilers/SpoilerShield';

interface LeftColProps {
  t: CharacterStrings;
  name: string;
  avatarUrl: string | null;
  isFavorite: boolean;
  reaction: CharacterReaction | null;
  onToggleFavorite: () => void;
  onReaction: (reaction: CharacterReaction) => void;
  onEditAvatar: () => void;
  /** Set while the spoiler shield blurs the portrait (a late debut). */
  avatarSpoiler?: { label: string | null; onReveal: () => void };
}

export function CharacterHeroLeftCol({ t, name, avatarUrl, isFavorite, reaction, onToggleFavorite, onReaction, onEditAvatar, avatarSpoiler }: LeftColProps) {
  return (
    <div className="character-hero-left-col">
      <CharacterActionRow
        t={t}
        isFavorite={isFavorite}
        reaction={reaction}
        onToggleFavorite={onToggleFavorite}
        onReaction={onReaction}
      />
      <div className="character-avatar-frame">
        <div className="character-avatar-wrap" id="char-avatar-container">
          {avatarUrl
            ? <img src={attributeUrl(avatarUrl)} alt={name} className={`character-avatar-img${avatarSpoiler ? ' spoiler-blur' : ''}`} />
            : <div className="character-avatar-placeholder">{t.no_image}</div>}
        </div>
        {avatarSpoiler && avatarUrl && <SpoilerChip onReveal={avatarSpoiler.onReveal} label={avatarSpoiler.label ?? undefined} />}
        <button className="char-avatar-edit-btn" id="char-avatar-edit-btn" title={t.edit_image} onClick={onEditAvatar}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

interface RightColProps {
  name: string;
  nameNative: string | null;
  aliases: CharacterAlias[];
  /** Extra notes under the names (the spoiler shield banner). */
  children?: ReactNode;
}

export function CharacterHeroRightCol({ name, nameNative, aliases, children }: RightColProps) {
  return (
    <div className="character-hero-right-col">
      <div className="character-name-row">
        <h1 className="media-title-main" id="char-name-full">{name}</h1>
      </div>
      <p className="media-title-native" id="char-name-native" style={{ display: nameNative ? 'block' : 'none', marginTop: '0.25rem' }}>
        {nameNative}
      </p>

      <div className="character-alt-names-wrap" id="char-alt-names-wrap" style={{ display: aliases.length > 0 ? 'block' : 'none' }}>
        <div className="character-alt-names" id="char-alt-names">
          {aliases.map(({ text, spoiler }) => (
            <span key={text} className="character-alt-name-tag">
              {spoiler ? <span className="spoiler">{text}</span> : text}
            </span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}
