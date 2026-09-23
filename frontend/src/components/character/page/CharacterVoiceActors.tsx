import { useState } from 'react';
import {
  defaultVoiceActorLanguage,
  splitVoiceActorName,
  voiceActorInitial,
  type MergedVoiceActor,
  type VoiceActorsByLanguage,
} from '../../../lib/character/character-voice-actors';
import { attributeUrl } from '../../../lib/character/character-page-urls';

function VoiceActorName({ raw }: { raw: string }) {
  const { name, suffix } = splitVoiceActorName(raw);
  if (!suffix) return <>{name}</>;
  return (
    <>
      {name} <small style={{ fontSize: '0.8em', opacity: 0.75, fontWeight: 'normal' }}>{suffix}</small>
    </>
  );
}

function VoiceActorPill({ va }: { va: MergedVoiceActor }) {
  return (
    <div className="media-author-pill">
      {va.image
        ? <img src={attributeUrl(va.image)} alt={va.name} className="media-author-avatar" />
        : <div className="media-author-avatar media-author-avatar--placeholder">{voiceActorInitial(va.name)}</div>}
      <div className="media-author-info">
        {va.siteUrl
          ? (
            <a href={attributeUrl(va.siteUrl)} target="_blank" rel="noopener noreferrer" className="media-author-name media-author-name--link" style={{ textDecoration: 'none', color: 'inherit' }}>
              <VoiceActorName raw={va.name} />
            </a>
          )
          : <span className="media-author-name"><VoiceActorName raw={va.name} /></span>}
        {va.native && va.native !== va.name && <span className="media-author-role">{va.native}</span>}
      </div>
    </div>
  );
}

export function CharacterVoiceActors({ voiceActors }: { voiceActors: VoiceActorsByLanguage }) {
  const { byLang, languages } = voiceActors;
  const [activeLang, setActiveLang] = useState(() => defaultVoiceActorLanguage(languages));
  const actors = byLang.get(activeLang) || [];

  return (
    <div className="char-seiyu-section" id="char-seiyu-section" style={{ display: languages.length > 0 ? 'block' : 'none', marginTop: '1rem' }}>
      <div className="media-authors-box" style={{ marginBottom: '0.75rem' }}>
        <div className="media-authors-list" id="char-seiyu-list">
          {actors.map(va => <VoiceActorPill key={va.externalId} va={va} />)}
        </div>
      </div>
      <div className="char-seiyu-lang-tabs" id="char-seiyu-lang-tabs">
        {languages.map(lang => (
          <button
            key={lang}
            type="button"
            className={`char-seiyu-lang-btn ${lang === activeLang ? 'char-seiyu-lang-btn--active' : ''}`}
            data-lang={lang}
            onClick={() => setActiveLang(lang)}
          >
            {lang}
          </button>
        ))}
      </div>
    </div>
  );
}
