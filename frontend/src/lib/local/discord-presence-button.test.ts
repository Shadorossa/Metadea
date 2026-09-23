import { describe, it, expect } from 'vitest';
import { mediaPresenceButton } from './discord-presence';

describe('mediaPresenceButton', () => {
  it('uses the rich share link when the catalog data matches the id', () => {
    expect(mediaPresenceButton('game:2136', {
      externalId: 'game:2136', title: 'Bayonetta', year: 2009,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co9xp1.jpg',
    })?.url).toBe('https://metadea.pages.dev/g/2136/bayonetta-2009/--co9xp1');
  });

  it('falls back to the /open/ redirect without usable data', () => {
    const fallback = 'https://shadorossa.github.io/Metadea/open/?to=media/anime:1';
    expect(mediaPresenceButton('anime:1')?.url).toBe(fallback);
    expect(mediaPresenceButton('anime:1', { externalId: 'anime:2', title: 'Other' })?.url).toBe(fallback);
    expect(mediaPresenceButton('anime:1', { externalId: 'anime:1', title: '' })?.url).toBe(fallback);
  });

  it('has no button for ids the app cannot open', () => {
    expect(mediaPresenceButton(undefined)).toBeUndefined();
    expect(mediaPresenceButton('../x')).toBeUndefined();
  });
});
