import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { es } from '../../i18n/es';
import { en } from '../../i18n/en';
import { findFinishAnniversaries, type FinishAnniversaryItem } from '../../lib/home/finish-anniversaries';
import { FinishAnniversaryStrip, MAX_VISIBLE_ANNIVERSARIES, type FinishAnniversaryStrings } from './FinishAnniversaryBanner';

const today = new Date(2026, 8, 23, 12);

function item(n: number, yearsAgo: number, coverUrl: string | null = `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/${n}.jpg`): FinishAnniversaryItem {
  return { externalId: `anime:a:${n}`, type: 'anime', title: `Work ${n}`, coverUrl, year: 2026 - yearsAgo, yearsAgo };
}

function render(items: FinishAnniversaryItem[], strings: FinishAnniversaryStrings = es.home, lang = 'es'): string {
  return renderToStaticMarkup(createElement(FinishAnniversaryStrip, { items, strings, lang, today }));
}

describe('FinishAnniversaryStrip', () => {
  it('renders nothing without anniversaries', () => {
    expect(render([])).toBe('');
  });

  it('shows every year together, each cover captioned with its own year and years ago', () => {
    // Real library rows from the Sep 23 bug report.
    const groups = findFinishAnniversaries(
      [
        { external_id: 'game:2136', type: 'game', finished_at: '2025-09-23' },
        { external_id: 'game:136', type: 'game', finished_at: '2022-09-23' },
      ],
      [
        { external_id: 'game:136', title_main: "Devil May Cry 3: Dante's Awakening", cover_url: null },
        { external_id: 'game:2136', title_main: 'Bayonetta', cover_url: null },
      ],
      today,
    );
    const html = render(groups.flatMap(g => g.items));
    expect(html.match(/class="home-anniversary-link"/g)).toHaveLength(2);
    const dmc = html.indexOf('game%3A136');
    const bayonetta = html.indexOf('game%3A2136');
    expect(dmc).toBeGreaterThan(-1);
    expect(bayonetta).toBeGreaterThan(dmc); // most years ago first
    expect(html).toContain('<span class="home-anniversary-caption-year">2022</span><span class="home-anniversary-caption-ago">Hace 4 años</span>');
    expect(html).toContain('<span class="home-anniversary-caption-year">2025</span><span class="home-anniversary-caption-ago">Hace 1 año</span>');
    expect(html).toContain('title="Devil May Cry 3: Dante&#x27;s Awakening"');
    expect(html).toContain('title="Bayonetta"');
  });

  it('renders the section header with the date and linked medium covers sized up front', () => {
    const html = render([item(1, 10), item(2, 10, null)]);
    expect(html).toContain('aria-labelledby="home-anniversary-title"');
    expect(html).toContain(`id="home-anniversary-title">${es.home.anniversary_heading}</h2>`);
    const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(today);
    expect(html).toContain(`<span class="home-anniversary-date">${day}</span>`);
    expect(html).toContain('<span class="home-anniversary-hover-title" aria-hidden="true">Work 1</span>');
    expect(html).toContain('href="/media?id=anime%3Aa%3A1"');
    expect(html).toContain('/cover/medium/1.jpg');
    expect(html).toContain('width="66" height="95" loading="eager" fetchPriority="high"');
    expect(html).toContain('home-anniversary-cover--empty');
  });

  it('picks the plural form from the locale', () => {
    const html = render([item(1, 3), item(2, 1)], en.home, 'en');
    expect(html).toContain('3 years ago');
    expect(html).toContain('1 year ago');
  });

  it(`caps the deck at ${MAX_VISIBLE_ANNIVERSARIES} covers plus a "+N" card`, () => {
    const html = render(Array.from({ length: 11 }, (_, i) => item(i + 1, 4)));
    expect(html.match(/class="home-anniversary-link"/g)).toHaveLength(MAX_VISIBLE_ANNIVERSARIES);
    expect(html).toContain('+3</button>');
    expect(html).toContain('aria-label="Mostrar 3 más"');
  });
});
