// Safety net for the character.astro → React island move: renders one
// fixture through the island (react-dom/server) and through the former
// page's markup (its static skeleton plus the innerHTML templates, copied
// verbatim from the old <script>), then compares the class-name sequences.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { es } from '../../../i18n/es';
import { escapeHtml, safeUrl } from '../../../lib/shared/text/sanitize-html';
import type { CharacterPageData } from '../../../lib/character/character-page-data';
import { CharacterPageView } from './CharacterPageView';

// DOMPurify needs a window; in node the sanitizers pass markup through.
vi.mock('../../../lib/shared/text/sanitize-html', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/shared/text/sanitize-html')>();
  return {
    ...actual,
    sanitizeHtml: (html: string | null | undefined) => html ?? '',
    sanitizeStatValue: (html: string | null | undefined) => html ?? '',
  };
});

const t = es.character;

const fixture: CharacterPageData = {
  externalId: 'character:a:40',
  name: 'Monkey D. Luffy',
  nameNative: 'モンキー・D・ルフィ',
  stickyImage: 'https://img/luffy.jpg',
  customImageUrl: null,
  aliases: [
    { text: 'Straw Hat', spoiler: false },
    { text: 'Joy Boy', spoiler: true },
  ],
  siteUrl: 'https://anilist.co/character/40',
  statRows: [
    { kind: 'stat', label: t.stat_gender, items: ['Male'] },
    { kind: 'header', label: t.section_physical },
    { kind: 'stat', label: t.stat_height, items: ['174 cm (post-timeskip)'] },
    { kind: 'stat', label: t.stat_affiliation, items: ['<a href="https://x">Straw Hat Pirates</a>', 'Ninja-Pirate-Mink-Samurai Alliance'] },
  ],
  biographyHtml: '<p>Captain of the <b>Straw Hat Pirates</b>. <span class="spoiler">Joy Boy</span></p>',
  voiceActors: {
    byLang: new Map([
      ['JP', [
        { externalId: 'person:a1', name: 'Mayumi Tanaka (田中真弓)', native: '田中真弓', image: 'https://img/tanaka.jpg', siteUrl: 'https://anilist.co/staff/1', language: 'Japanese' },
        { externalId: 'va:Manual', name: 'Manual VA', native: '', image: '', siteUrl: '', language: 'Japanese' },
      ]],
      ['EN', [
        { externalId: 'person:a2', name: 'Colleen Clinkenbeard', native: '', image: '', siteUrl: 'https://anilist.co/staff/2', language: 'English' },
      ]],
    ]),
    languages: ['JP', 'EN'],
  },
  appearances: [
    { mediaId: 'anime:21', title: 'One Piece', cover: 'https://img/op.jpg', year: 1999, month: 10, day: 20, roleLabel: t.role_main },
    { mediaId: 'lnovel:2', title: 'One Piece Novel', cover: null, year: null, month: null, day: null, roleLabel: '' },
  ],
  isFavorite: true,
  reaction: 'like',
};

// ── Former character.astro markup ───────────────────────────────────────────
// Static content block (lines 26–129 of the old page) with the dynamic parts
// filled in by the old script's own innerHTML templates.

function legacyStatValueContent(raw: string): string {
  const cleaned = raw.replace(/<\/?small>/gi, '').trim();
  const match = cleaned.match(/^(.*?)\s*(\([^)]+\))$/);
  if (match && match[1].trim()) {
    return `<div class="media-stat-val-main">${match[1].trim()}</div><div class="media-stat-val-sub">${match[2].trim()}</div>`;
  }
  return `<div class="media-stat-val-main">${cleaned}</div>`;
}

function legacyStatItemHtml(displayLabel: string, items: string[]): string {
  if (items.length === 0) return '';
  const isCarousel = items.length > 1;
  let valueContent: string;
  if (!isCarousel) {
    valueContent = legacyStatValueContent(items[0]);
  } else {
    const itemsHtml = items.map((val, idx) => {
      const plainText = val.replace(/<[^>]+>/g, '').trim();
      const isFirst = idx === 0;
      return `<div class="media-stat-carousel-item ${isFirst ? 'active' : ''}" style="${isFirst ? '' : 'display: none;'}" title="${escapeHtml(plainText)}">${legacyStatValueContent(val)}</div>`;
    }).join('');
    valueContent = `
      <div class="media-stat-carousel">
        <button type="button" class="media-stat-carousel-btn media-stat-carousel-prev" title="${escapeHtml(t.pagination_prev)}" aria-label="${escapeHtml(t.pagination_prev)}">‹</button>
        <div class="media-stat-carousel-items">${itemsHtml}</div>
        <button type="button" class="media-stat-carousel-btn media-stat-carousel-next" title="${escapeHtml(t.pagination_next)}" aria-label="${escapeHtml(t.pagination_next)}">›</button>
      </div>
    `.trim();
  }
  return `
    <div class="media-stat-item">
      <div class="media-stat-main-row">
        <span class="media-stat-label">${escapeHtml(displayLabel)}</span>
        <div class="media-stat-value">${valueContent}</div>
      </div>
      <div class="media-stat-divider-row">
        <div class="media-stat-divider-line"></div>
        ${isCarousel ? `<span class="media-stat-carousel-count">(1/${items.length})</span>` : ''}
      </div>
    </div>
  `.trim();
}

function legacyVoiceActorName(rawName: string): string {
  const match = rawName.match(/^([^(]+)(?:\s*(\([^)]+\)))?$/);
  if (!match || !match[2]) return escapeHtml(rawName);
  return `${escapeHtml(match[1].trim())} <small style="font-size: 0.8em; opacity: 0.75; font-weight: normal;">${escapeHtml(match[2].trim())}</small>`;
}

function legacyContentHtml(d: CharacterPageData): string {
  const avatar = d.customImageUrl || d.stickyImage;
  const activeLang = d.voiceActors.languages.includes('JP') ? 'JP' : d.voiceActors.languages[0];
  const vas = d.voiceActors.byLang.get(activeLang) || [];
  const statsHtml = d.statRows.map(row => row.kind === 'header'
    ? `<div class="media-stat-section-header">${escapeHtml(row.label)}</div>`
    : legacyStatItemHtml(row.label, row.items)).join('');
  const totalPages = Math.ceil(d.appearances.length / 8);
  const slice = d.appearances.slice(0, 8);

  return `
    <div id="character-content" style="display: block;" data-char-key="${d.externalId}">
      <div class="character-grid">
        <div class="character-main-content">
          <div class="character-hero-left-col">
            <div class="character-action-row" id="char-action-row">
              <button class="char-action-btn${d.isFavorite ? ' active' : ''}" id="char-fav-btn" data-action="favorite" title="${t.action_favorite}"><svg></svg><span>${t.action_favorite}</span></button>
              <button class="char-action-btn${d.reaction === 'like' ? ' active' : ''}" id="char-like-btn" data-action="like" data-reaction="like" title="${t.action_like}" disabled><svg></svg><span>${t.action_like}</span></button>
              <button class="char-action-btn${d.reaction === 'interest' ? ' active' : ''}" id="char-interested-btn" data-action="interested" data-reaction="interested" title="${t.action_interested}" disabled><svg></svg><span>${t.action_interested}</span></button>
              <button class="char-action-btn${d.reaction === 'dislike' ? ' active' : ''}" id="char-dislike-btn" data-action="dislike" data-reaction="dislike" title="${t.action_dislike}" disabled><svg></svg><span>${t.action_dislike}</span></button>
            </div>
            <div class="character-avatar-frame">
              <div class="character-avatar-wrap" id="char-avatar-container">${avatar
                ? `<img src="${safeUrl(avatar)}" alt="${escapeHtml(d.name)}" class="character-avatar-img" />`
                : `<div class="character-avatar-placeholder">${escapeHtml(t.no_image)}</div>`}</div>
              <button class="char-avatar-edit-btn" id="char-avatar-edit-btn" title="${t.edit_image}"><svg></svg></button>
            </div>
          </div>

          <div class="character-hero-right-col">
            <div class="character-name-row">
              <h1 class="media-title-main" id="char-name-full">${escapeHtml(d.name)}</h1>
            </div>
            <p class="media-title-native" id="char-name-native" style="display: ${d.nameNative ? 'block' : 'none'}; margin-top: 0.25rem;">${escapeHtml(d.nameNative ?? '')}</p>
            <div class="character-alt-names-wrap" id="char-alt-names-wrap" style="display: ${d.aliases.length ? 'block' : 'none'};">
              <div class="character-alt-names" id="char-alt-names">${d.aliases
                .map(({ text, spoiler }) => spoiler
                  ? `<span class="character-alt-name-tag"><span class="spoiler">${escapeHtml(text)}</span></span>`
                  : `<span class="character-alt-name-tag">${escapeHtml(text)}</span>`)
                .join('')}</div>
            </div>
          </div>

          <div class="media-col-synopsis" id="char-bio-section" style="display: ${d.biographyHtml ? 'block' : 'none'};">
            <div class="media-section-header-row">
              <p class="section-label">${t.biography}</p>
              <div class="media-section-header-line"></div>
            </div>
            <div class="media-description-text" id="char-description">${d.biographyHtml}</div>
          </div>

          <div class="media-col-related" id="char-appearances-section" style="display: ${d.appearances.length ? 'block' : 'none'};">
            <div class="media-section-header-row">
              <p class="section-label">${t.appearances}</p>
              <div class="media-section-header-line"></div>
            </div>
            <div class="media-relations-grid" id="char-appearances-grid">${slice
              .map(app => `
              <a href="/media?id=${encodeURIComponent(app.mediaId)}" class="media-relation-card">
                ${app.cover ? `<div class="media-relation-bg-layer"><img src="${safeUrl(app.cover)}" alt="" /></div>` : ''}
                <div class="media-relation-card-overlay"></div>
                <div class="media-relation-card-content">
                  <div class="media-relation-thumb">
                    ${app.cover ? `<img src="${safeUrl(app.cover)}" alt="${escapeHtml(app.title)}" loading="lazy" />` : ''}
                  </div>
                  <div class="media-relation-info">
                    <span class="media-relation-title">${escapeHtml(app.title)}</span>
                  </div>
                </div>
                ${app.roleLabel ? `<div class="media-relation-type">${escapeHtml(app.roleLabel)}</div>` : ''}
              </a>
            `)
              .join('')}</div>

            <div id="appearances-pagination" style="display: ${totalPages > 1 ? 'flex' : 'none'}; justify-content: center; align-items: center; gap: 1.5rem; margin-top: 2rem; border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
              <button class="btn btn--sm btn--secondary" id="btn-prev-appearances" style="min-width: 100px;">${t.pagination_prev}</button>
              <span id="txt-appearances-page" style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">${t.pagination_page.replace('{page}', '1').replace('{total}', String(totalPages))}</span>
              <button class="btn btn--sm btn--secondary" id="btn-next-appearances" style="min-width: 100px;">${t.pagination_next}</button>
            </div>
          </div>
        </div>

        <div class="media-col-stats character-hero-stats" id="char-stats-card" style="display: flex;">
        <button type="button" class="btn btn--sm btn--secondary char-edit-btn-header" id="char-edit-btn-header" title="${t.edit_tooltip}" aria-label="${t.edit_button}"><svg></svg></button>
        <div class="media-section-header-row">
          <p class="section-label">${t.details}</p>
          <div class="media-section-header-line"></div>
          <div id="char-api-link-wrap" style="display: ${d.siteUrl ? 'block' : 'none'};">${d.siteUrl ? `
            <a href="${safeUrl(d.siteUrl)}" target="_blank" rel="noopener noreferrer" class="media-store-link" title="AniList">
              <img src="/API/Anilist_logo.png" alt="AniList" class="media-store-icon" />
            </a>
          ` : ''}</div>
        </div>
        <div class="media-stats-list" id="char-stats-list" style="display: ${statsHtml ? 'block' : 'none'};">${statsHtml}</div>

        <div class="char-seiyu-section" id="char-seiyu-section" style="display: ${d.voiceActors.languages.length ? 'block' : 'none'}; margin-top: 1rem;">
          <div class="media-authors-box" style="margin-bottom: 0.75rem;">
            <div class="media-authors-list" id="char-seiyu-list">${vas
              .map(va => {
                const baseInitial = (va.name.replace(/\s*\([^)]*\)/g, '').trim().charAt(0) || '?').toUpperCase();
                return `
              <div class="media-author-pill">
                ${va.image
                  ? `<img src="${safeUrl(va.image)}" alt="${escapeHtml(va.name)}" class="media-author-avatar" />`
                  : `<div class="media-author-avatar media-author-avatar--placeholder">${escapeHtml(baseInitial)}</div>`}
                <div class="media-author-info">
                  ${va.siteUrl
                    ? `<a href="${safeUrl(va.siteUrl)}" target="_blank" rel="noopener noreferrer" class="media-author-name media-author-name--link" style="text-decoration: none; color: inherit;">${legacyVoiceActorName(va.name)}</a>`
                    : `<span class="media-author-name">${legacyVoiceActorName(va.name)}</span>`}
                  ${va.native && va.native !== va.name ? `<span class="media-author-role">${escapeHtml(va.native)}</span>` : ''}
                </div>
              </div>
            `;
              }).join('')}</div>
          </div>
          <div class="char-seiyu-lang-tabs" id="char-seiyu-lang-tabs">${d.voiceActors.languages
            .map(lang => `
              <button
                type="button"
                class="char-seiyu-lang-btn ${lang === activeLang ? 'char-seiyu-lang-btn--active' : ''}"
                data-lang="${escapeHtml(lang)}"
              >
                ${escapeHtml(lang)}
              </button>
            `).join('')}</div>
        </div>
      </div>

      </div>

    </div>
  `;
}

// ── Comparison ──────────────────────────────────────────────────────────────

function classSequence(html: string): string[] {
  return Array.from(html.matchAll(/\bclass="([^"]*)"/g)).flatMap(m => m[1].trim().split(/\s+/).filter(Boolean));
}

function idSequence(html: string): string[] {
  return Array.from(html.matchAll(/\bid="([^"]*)"/g)).map(m => m[1]);
}

function textContent(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const noop = () => {};

function renderIsland(data: CharacterPageData): string {
  return renderToStaticMarkup(createElement(CharacterPageView, {
    t,
    data,
    avatarUrl: data.customImageUrl || data.stickyImage,
    isFavorite: data.isFavorite,
    reaction: data.reaction,
    onToggleFavorite: noop,
    onReaction: noop,
    onEditAvatar: noop,
    onEdit: noop,
  }));
}

describe('CharacterPageView vs former character.astro markup', () => {
  const island = renderIsland(fixture);
  const legacy = legacyContentHtml(fixture);

  it('emits the same class names in the same order', () => {
    expect(classSequence(island)).toEqual(classSequence(legacy));
  });

  it('keeps every element id the CSS and other scripts target, in order', () => {
    expect(idSequence(island)).toEqual(idSequence(legacy));
  });

  it('renders the same visible text', () => {
    expect(textContent(island)).toBe(textContent(legacy));
  });

  it('matches the empty-state variant too (no image, no aliases, no stats, no cast, no appearances)', () => {
    const empty: CharacterPageData = {
      ...fixture,
      stickyImage: null,
      nameNative: null,
      aliases: [],
      siteUrl: '',
      statRows: [],
      biographyHtml: '',
      voiceActors: { byLang: new Map(), languages: [] },
      appearances: [],
      isFavorite: false,
      reaction: null,
    };
    expect(classSequence(renderIsland(empty))).toEqual(classSequence(legacyContentHtml(empty)));
    expect(idSequence(renderIsland(empty))).toEqual(idSequence(legacyContentHtml(empty)));
  });

  it('escapes community-submitted text instead of interpreting it as markup', () => {
    const hostile = renderIsland({ ...fixture, name: '<img src=x onerror=alert(1)>', aliases: [{ text: '<b>x</b>', spoiler: false }] });
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(hostile).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
