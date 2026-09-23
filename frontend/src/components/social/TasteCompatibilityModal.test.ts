import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import type { CatalogSummary } from '../../lib/tauri';
import type { TasteCompatibilityData } from '../../lib/tauri/social-profile';
import { computeTasteCompatibility, type TasteLibrarySignals } from '../../lib/social/taste-compatibility';
import { TasteComparison } from './TasteCompatibilityModal';

const fixture: TasteCompatibilityData = {
  own_engaged: 40, their_engaged: 60, shared_works: 18, shared_completed: 12, shared_engaged: 15,
  both_rated: 9,
  mean_abs_diff: 0.2,
  rating_pairs: [
    { external_id: 'anime:1', own: 1, their: 1 },
    { external_id: 'anime:2', own: 0.9, their: 1 },
    { external_id: 'anime:3', own: 0.8, their: 0.8 },
    { external_id: 'anime:4', own: 0.7, their: 0.6 },
    { external_id: 'game:1', own: 0.9, their: 0.9 },
    { external_id: 'game:2', own: 0.8, their: 0.7 },
    { external_id: 'game:3', own: 1, their: 0.3 },
    { external_id: 'manga:1', own: 0.2, their: 0.9 },
    { external_id: 'manga:2', own: 0.6, their: 0.6 },
  ],
  shared_favorites: ['anime:1'],
  shared_favorites_total: 1,
};

const catalogMap = new Map<string, CatalogSummary>([
  ['anime:2', { external_id: 'anime:2', title_main: 'Mushishi', cover_url: null } as CatalogSummary],
  ['game:3', { external_id: 'game:3', title_main: 'Bayonetta', cover_url: null } as CatalogSummary],
]);

function render(data: TasteCompatibilityData, signals?: TasteLibrarySignals): string {
  return renderToStaticMarkup(createElement(TasteComparison, {
    taste: computeTasteCompatibility(data, signals),
    catalogMap,
    theirName: 'Alice',
    theirAvatarUrl: null,
    s: en.social,
    onNavigate: () => {},
    ownAvatarUrl: null,
    ownName: 'Bob',
    ownBannerUrl: null,
  }));
}

describe('TasteComparison', () => {
  it('renders the score, stats, breakdown, by-type split and every section', () => {
    const html = render(fixture);
    expect(html).toMatch(/taste-modal-score-value">\d+%</);
    for (const label of [
      en.social.taste_stat_shared, en.social.taste_stat_both_completed, en.social.taste_breakdown,
      en.social.taste_component_rating, en.social.taste_by_type, en.social.taste_shared_favs,
      en.social.taste_both_loved, en.social.taste_disagreements,
    ]) expect(html).toContain(label);
    expect(html).toContain('>12<'); // both completed
    // rating / genre / hours / status / overlap / profile / favourites + anime/game (manga: too few)
    expect(html.match(/class="taste-modal-bar"/g)!.length).toBe(7 + 2);
    for (const key of ['overlap', 'status', 'genre', 'hours', 'profile', 'favorites'] as const) {
      expect(html).toContain(en.social[`taste_component_${key}`].replace('&', '&amp;'));
    }
    // Disagreements: largest gap first, both ratings shown, linked to the media page.
    expect(html.indexOf('game%3A3')).toBeLessThan(html.indexOf('manga%3A1'));
    expect(html).toContain('Bayonetta');
    expect(html).toContain('>Alice<');
    expect(html).not.toContain(en.social.taste_nothing_yet);
    // Average difference: big number + compact muted scale.
    expect(html).toMatch(/taste-modal-stat-value">[\d.]+<span class="taste-modal-stat-suffix">\/5<\/span>/);
    // Section-header title, never a themed (underlined) heading.
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it('always shows a percentage, even with almost nothing rated by both', () => {
    const html = render({ ...fixture, both_rated: 1, rating_pairs: fixture.rating_pairs.slice(0, 1), shared_favorites: [] });
    expect(html).toMatch(/taste-modal-score-value">\d+%</);
    expect(html).toContain('Based on 18 shared works');
    // No library signals here: those bars have no weight and read as a dash.
    expect(html).toContain('taste-modal-bar-value">—<');
    expect(html).not.toContain(en.social.taste_by_type);
  });

  it('says there is nothing to highlight when no section has works', () => {
    const html = render({ ...fixture, both_rated: 0, mean_abs_diff: null, rating_pairs: [], shared_favorites: [] });
    expect(html).toContain(en.social.taste_nothing_yet);
    expect(html).toContain('—');
  });

  it('shows the verdict, shared genres, the time split and confetti on a very high score', () => {
    const signals: TasteLibrarySignals = {
      statusSimilarity: 1, statusShared: 12, genreSimilarity: 1, hoursSimilarity: 0.9, hoursEvidence: 300,
      profileSimilarity: 1, nonSharedEvidence: 30,
      ownTime: [{ type: 'anime', hours: 300, share: 0.75 }, { type: 'game', hours: 100, share: 0.25 }],
      theirTime: [{ type: 'anime', hours: 200, share: 1 }],
      sharedGenres: [{ genre: 'Action', own: 0.3, their: 0.25 }, { genre: 'Drama', own: 0.1, their: 0.2 }],
    };
    const loving = fixture.rating_pairs.map(p => ({ ...p, their: p.own }));
    const html = render({ ...fixture, rating_pairs: loving, mean_abs_diff: 0, shared_favorites_total: 4 }, signals);
    expect(html).toContain(en.social.taste_verdict_soulmates);
    expect(html).toContain('taste-confetti');
    expect(html).toContain(en.social.taste_genres_title);
    expect(html).toContain('>Action<');
    expect(html).toContain(en.social.taste_time_title);
    expect(html.match(/class="taste-time-segment"/g)!.length).toBe(3);
    expect(html).toContain('>400 h<'); // your total
    expect(html).toMatch(/aria-label="\d+% compatible"/);
  });

  it('a low score gets a different verdict and no confetti', () => {
    const opposed = fixture.rating_pairs.map(p => ({ ...p, their: 1 - p.own }));
    const html = render({ ...fixture, rating_pairs: opposed, mean_abs_diff: 0.6, shared_favorites: [], shared_favorites_total: 0 });
    expect(html).not.toContain(en.social.taste_verdict_soulmates);
    expect(html).not.toContain('taste-confetti');
    expect(html).not.toContain(en.social.taste_time_title);
  });
});
