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
import { useKeyedState } from '../shared/hooks/useKeyedState';
export type { CharacterPreviewChangeKind, CharacterPreviewAppearance, CharacterPreviewChanges } from '../../lib/github/proposal-diff';
import type { CharacterPreviewChangeKind, CharacterPreviewAppearance, CharacterPreviewChanges } from '../../lib/github/proposal-diff';
import { mapById } from '../../lib/shared/collections/batch';
import { getT } from '../../i18n/runtime';
import { parseCharacterBiography } from '../../lib/character/biography-parser';
import { parseStatSectionLabel, StatSectionTracker } from '../../lib/media/stat-sections';
import { sanitizeHtml, sanitizeStatValue } from '../../lib/shared/text/sanitize-html';
import { getCatalogEntry, type MediaCatalogEntry } from '../../lib/tauri/catalog';
import type { CharacterEntry } from '../../lib/tauri/characters';
import type { CharacterProposalActor } from '../../lib/github/submit-collaborative-proposal';




interface Props {
  character: CharacterEntry;
  appearances: CharacterPreviewAppearance[];
  actors?: CharacterProposalActor[];
  mergedCharacterIds?: string[];
  changes?: CharacterPreviewChanges;
}

function diffClass(kind?: CharacterPreviewChangeKind): string {
  return kind ? ` character-preview-diff--${kind}` : '';
}

function parseStatItems(rawValue: string): string[] {
  const lines = rawValue
    .replace(/<\/?(?:ul|ol)[^>]*>/gi, '')
    .replace(/<\/?li[^>]*>/gi, '\n')
    .split(/<br\s*\/?>|\n/i)
    .map(value => value.trim())
    .filter(Boolean);

  return lines.flatMap(line => {
    const clean = line.replace(/<\/?small>/gi, '').trim();
    return clean.includes(',') && !clean.includes('(') ? clean.split(',').map(value => value.trim()) : [clean];
  }).filter(Boolean);
}

function formatStatValue(rawValue: string) {
  const cleaned = rawValue.replace(/<\/?small>/gi, '').trim();
  const match = cleaned.match(/^(.*?)\s*(\([^)]+\))$/);
  if (match && match[1].trim()) {
    return (
      <>
        <div className="media-stat-val-main" dangerouslySetInnerHTML={{ __html: sanitizeStatValue(match[1].trim()) }} />
        <div className="media-stat-val-sub" dangerouslySetInnerHTML={{ __html: sanitizeStatValue(match[2].trim()) }} />
      </>
    );
  }
  return <div className="media-stat-val-main" dangerouslySetInnerHTML={{ __html: sanitizeStatValue(cleaned) }} />;
}

function CharacterStatItem({ label, value }: { label: string; value: string }) {
  const t = getT().character;
  const values = parseStatItems(value);
  const [activeIndex, setActiveIndex] = useKeyedState(value, 0);
  if (values.length === 0) return null;

  const move = (direction: -1 | 1) => {
    setActiveIndex(current => (current + direction + values.length) % values.length);
  };

  return (
    <div className="media-stat-item">
      <div className="media-stat-main-row">
        <span className="media-stat-label">{label}</span>
        <div className="media-stat-value">
          {values.length > 1 ? (
            <div className="media-stat-carousel">
              <button type="button" className="media-stat-carousel-btn media-stat-carousel-prev" title={t.pagination_prev} aria-label={t.pagination_prev} onClick={() => move(-1)}>‹</button>
              <div className="media-stat-carousel-items">
                {values.map((item, index) => (
                  <div
                    key={`${index}-${item}`}
                    className={`media-stat-carousel-item${index === activeIndex ? ' active' : ''}`}
                    style={{ display: index === activeIndex ? undefined : 'none' }}
                    title={item.replace(/<[^>]+>/g, '').trim()}
                  >
                    {formatStatValue(item)}
                  </div>
                ))}
              </div>
              <button type="button" className="media-stat-carousel-btn media-stat-carousel-next" title={t.pagination_next} aria-label={t.pagination_next} onClick={() => move(1)}>›</button>
            </div>
          ) : formatStatValue(values[0])}
        </div>
      </div>
      <div className="media-stat-divider-row">
        <div className="media-stat-divider-line" />
        {values.length > 1 && <span className="media-stat-carousel-count">({activeIndex + 1}/{values.length})</span>}
      </div>
    </div>
  );
}

export function CharacterPreviewCard({ character, appearances, actors = [], mergedCharacterIds = [], changes }: Props) {
  const t = getT().character;
  const editorT = getT().character_editor;
  const { characteristics, cleanBiography } = parseCharacterBiography(character.biography);
  const aliases = (character.aliases_csv ?? '').split(',').map(a => a.trim()).filter(Boolean);
  const basicStats = [
    ...(character.gender ? [{ label: t.stat_gender, value: character.gender }] : []),
    ...(character.age ? [{ label: t.stat_age, value: character.age }] : []),
    ...(character.blood_type ? [{ label: t.stat_blood_type, value: character.blood_type }] : []),
    ...((character.dob_day || character.dob_month)
      ? [{ label: t.stat_birthday, value: `${character.dob_day ?? '?'}/${character.dob_month ?? '?'}${character.dob_year ? `/${character.dob_year}` : ''}` }]
      : []),
  ];
  const basicStatLabels = new Set([
    'gender', 'sex', 'género', 'sexo', 'age', 'edad', 'bloodtype', 'blood type', 'grupo sanguíneo',
    'birthday', 'cumpleaños',
  ]);
  const parsedStats = characteristics.map(stat => {
    const { section, cleanLabel } = parseStatSectionLabel(stat.label);
    return { ...stat, section, cleanLabel };
  });
  for (let i = 0; i < parsedStats.length - 1; i++) {
    if (!parsedStats[i].section && parsedStats[i + 1].section && parsedStats[i].cleanLabel.toLowerCase() === parsedStats[i + 1].section!.toLowerCase()) {
      parsedStats[i].section = parsedStats[i + 1].section;
    }
  }
  const sectionTracker = new StatSectionTracker();
  const visibleStats = parsedStats.flatMap(stat => {
    const label = stat.cleanLabel.toLowerCase();
    if (basicStatLabels.has(label) || label.includes('alias') || label.includes('nombre') || label.includes('name') || label.includes('aka')) return [];
    return [{ ...stat, sectionHeader: sectionTracker.next(stat.section) }];
  });
  const languageCodes: Record<string, string> = {
    japanese: 'JP', spanish: 'ES', english: 'EN', italian: 'IT', french: 'FR',
    german: 'DE', portuguese: 'PT', korean: 'KR', chinese: 'ZH', mandarin: 'ZH',
  };
  const getLanguageCode = (language?: string | null) => {
    const normalized = (language || 'Japanese').toLowerCase();
    return languageCodes[normalized] || normalized.slice(0, 2).toUpperCase();
  };
  const languagePriority = ['JP', 'ES', 'EN', 'IT', 'FR', 'DE', 'PT', 'KR', 'ZH'];
  const actorLanguages = Array.from(new Set(actors.map(actor => getLanguageCode(actor.language))))
    .sort((a, b) => {
      const indexA = languagePriority.indexOf(a);
      const indexB = languagePriority.indexOf(b);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return a.localeCompare(b);
    });
  const preferredLanguage = actorLanguages.includes('JP') ? 'JP' : actorLanguages[0] ?? '';
  const [activeActorLanguage, setActiveActorLanguage] = useKeyedState(preferredLanguage, preferredLanguage);

  // Resolving each appearance's title/cover is the one thing here that
  // isn't already sitting in the bundle — same local-catalog lookup the
  // real page falls back to for a work it hasn't fetched live data for.
  const [appearanceMeta, setAppearanceMeta] = useState<Record<string, MediaCatalogEntry | null>>({});
  useEffect(() => {
    let cancelled = false;
    mapById(appearances.map(a => a.media_external_id), id => getCatalogEntry(id).catch(() => null))
      .then(results => { if (!cancelled) setAppearanceMeta(Object.fromEntries(results)); });
    return () => { cancelled = true; };
  }, [appearances]);

  return (
    <div id="character-content" data-char-key={character.external_id}>
      <div className="character-grid">
        <div className="character-main-content">
          <div className="character-hero-left-col">
            <div className={`character-avatar-frame${diffClass(changes?.fields.image_url)}`}>
              <div className="character-avatar-wrap" id="char-avatar-container">
                {character.image_url
                  ? <img src={character.image_url} alt={character.name} className="character-avatar-img" />
                  : <div className="character-avatar-placeholder">{t.no_image}</div>}
              </div>
            </div>
          </div>

          <div className="character-hero-right-col">
            <div className={`character-name-row character-preview-field${diffClass(changes?.fields.name)}`}>
              <h1 className="media-title-main" id="char-name-full">{character.name}</h1>
            </div>
            {character.name_native && (
              <p id="char-name-native" className={`media-title-native character-preview-field${diffClass(changes?.fields.name_native)}`}>
                {character.name_native}
              </p>
            )}
            {aliases.length > 0 && (
              <div id="char-alt-names-wrap" className={`character-alt-names-wrap character-preview-field${diffClass(changes?.fields.aliases_csv)}`}>
                <div className="character-alt-names" id="char-alt-names">
                  {aliases.map(a => <span key={a} className="character-alt-name-tag">{a}</span>)}
                </div>
              </div>
            )}
          </div>

          {cleanBiography && (
            <div className="media-col-synopsis" id="char-bio-section">
              <div className="media-section-header-row">
                <p className="section-label">{t.biography}</p>
                <div className="media-section-header-line" />
              </div>
              <div
                id="char-description"
                className={`media-description-text character-preview-field${diffClass(changes?.fields.biography)}`}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(cleanBiography) }}
              />
            </div>
          )}

          {appearances.length > 0 && (
            <div className="media-col-related" id="char-appearances-section">
              <div className="media-section-header-row">
                <p className="section-label">{t.appearances}</p>
                <div className="media-section-header-line" />
              </div>
              <div className="media-relations-grid" id="char-appearances-grid">
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
        </div>

        {(basicStats.length > 0 || visibleStats.length > 0 || actors.length > 0 || mergedCharacterIds.length > 0) && (
          <div className="media-col-stats character-hero-stats" id="char-stats-card">
            <div className="media-section-header-row">
              <p className="section-label">{t.details}</p>
              <div className="media-section-header-line" />
            </div>
            <div className="media-stats-list" id="char-stats-list">
              {basicStats.map(stat => <CharacterStatItem key={stat.label} label={stat.label} value={stat.value} />)}
              {visibleStats.map((stat, index) => (
                <div key={`${stat.label}-${index}`}>
                  {stat.sectionHeader && <div className="media-stat-section-header">{stat.sectionHeader}</div>}
                  <CharacterStatItem label={stat.cleanLabel} value={stat.value} />
                </div>
              ))}
              {mergedCharacterIds.length > 0 && (
                <div className="media-stat-item">
                  <div className="media-stat-main-row">
                    <span className="media-stat-label">{editorT.merges}</span>
                    <div className="media-stat-value">
                      {mergedCharacterIds.map(id => (
                        <span key={id} className={`character-preview-field${diffClass(changes?.merges[id])}`} title={id}>{id}</span>
                      ))}
                    </div>
                  </div>
                  <div className="media-stat-divider-row"><div className="media-stat-divider-line" /></div>
                </div>
              )}
            </div>

            {actors.length > 0 && (
              <div className="char-seiyu-section" id="char-seiyu-section" style={{ marginTop: '1rem' }}>
                <div className="media-authors-box" style={{ marginBottom: '0.75rem' }}>
                  <div className="media-authors-list" id="char-seiyu-list">
                    {actors.filter(actor => getLanguageCode(actor.language) === activeActorLanguage).map(actor => (
                      <div key={actor.external_id} className={`media-author-pill character-preview-field${diffClass(changes?.actors[actor.external_id])}`}>
                        {actor.image_url
                          ? <img src={actor.image_url} alt={actor.name || ''} className="media-author-avatar" loading="lazy" />
                          : <div className="media-author-avatar media-author-avatar--placeholder">{(actor.name || '?').trim().charAt(0).toUpperCase()}</div>}
                        <div className="media-author-info">
                          <span className="media-author-name">{actor.name || actor.external_id}</span>
                          {actor.name_native && actor.name_native !== actor.name && <span className="media-author-role">{actor.name_native}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="char-seiyu-lang-tabs" id="char-seiyu-lang-tabs">
                  {actorLanguages.map(language => (
                    <button
                      key={language}
                      type="button"
                      className={`char-seiyu-lang-btn${language === activeActorLanguage ? ' char-seiyu-lang-btn--active' : ''}`}
                      aria-pressed={language === activeActorLanguage}
                      onClick={() => setActiveActorLanguage(language)}
                    >
                      {language}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
