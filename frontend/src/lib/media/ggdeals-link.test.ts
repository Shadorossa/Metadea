import { describe, expect, it } from 'vitest';
import { ggDealsLink, ggDealsSearchUrl, steamAppIdFromStoreLinks, steamAppIdFromUrl } from './ggdeals-link';

describe('steamAppIdFromUrl', () => {
  it('reads the app id from the common Steam store URL shapes', () => {
    expect(steamAppIdFromUrl('https://store.steampowered.com/app/1245620')).toBe('1245620');
    expect(steamAppIdFromUrl('https://store.steampowered.com/app/1245620/')).toBe('1245620');
    expect(steamAppIdFromUrl('https://store.steampowered.com/app/1245620/ELDEN_RING/')).toBe('1245620');
    expect(steamAppIdFromUrl('https://store.steampowered.com/app/1245620/?l=spanish&cc=es')).toBe('1245620');
    expect(steamAppIdFromUrl('http://store.steampowered.com/app/620?snr=1_5_9')).toBe('620');
  });

  it('ignores sub/bundle URLs, other hosts and malformed input', () => {
    expect(steamAppIdFromUrl('https://store.steampowered.com/sub/12345/')).toBeNull();
    expect(steamAppIdFromUrl('https://store.steampowered.com/bundle/232/Valve_Complete_Pack/')).toBeNull();
    expect(steamAppIdFromUrl('https://store.steampowered.com/app/abc/')).toBeNull();
    expect(steamAppIdFromUrl('https://store.steampowered.com/app/0/')).toBeNull();
    expect(steamAppIdFromUrl('https://www.gog.com/app/123')).toBeNull();
    expect(steamAppIdFromUrl('not a url')).toBeNull();
  });
});

describe('steamAppIdFromStoreLinks', () => {
  it('finds the Steam link among other stores', () => {
    expect(steamAppIdFromStoreLinks([
      { platform: 'gog', url: 'https://www.gog.com/game/witcher_3' },
      { platform: 'steam', url: 'https://store.steampowered.com/app/292030/The_Witcher_3/' },
    ])).toBe('292030');
    expect(steamAppIdFromStoreLinks(null)).toBeNull();
    expect(steamAppIdFromStoreLinks([{ platform: 'steam', url: 'https://store.steampowered.com/sub/1/' }])).toBeNull();
  });
});

describe('ggDealsLink', () => {
  it('uses the Steam app route when an app id is known', () => {
    expect(ggDealsLink({
      title: 'Portal 2',
      storeLinks: [{ platform: 'steam', url: 'https://store.steampowered.com/app/620/Portal_2/' }],
    })).toBe('https://gg.deals/steam/app/620/');
  });

  it('prefers an explicit Steam app id over store links', () => {
    expect(ggDealsLink({
      title: 'Portal 2',
      steamAppId: '400',
      storeLinks: [{ platform: 'steam', url: 'https://store.steampowered.com/app/620/' }],
    })).toBe('https://gg.deals/steam/app/400/');
  });

  it('falls back to an encoded title search', () => {
    expect(ggDealsLink({ title: 'Doki Doki Literature Club!', storeLinks: [] }))
      .toBe('https://gg.deals/search/?title=Doki%20Doki%20Literature%20Club!');
    expect(ggDealsSearchUrl(' Tom & Jerry: 100% / ¿Sí? ')).toBe(
      'https://gg.deals/search/?title=Tom%20%26%20Jerry%3A%20100%25%20%2F%20%C2%BFS%C3%AD%3F',
    );
    expect(ggDealsLink({ title: 'Steins;Gate', steamAppId: 'abc' }))
      .toBe('https://gg.deals/search/?title=Steins%3BGate');
  });
});
