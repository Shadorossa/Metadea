// Hello Source — the example Metadea plugin (docs/PLUGINS.md).
//
// A classic worker script: no import/export. Metadea runs it in its own Web
// Worker with `metadea` (the SDK) in scope. Everything here is made up and
// served from memory or `metadea.storage`; the plugin declares no hosts, so
// `metadea.http.fetch` would be refused.

const WORKS = [
  {
    id: 'hello-1',
    title: 'The Journey Example',
    type: 'manga',
    // Any AniList manga id works here: Metadea prefers an anilistId match
    // over a title match when it picks this work for a media page.
    anilistId: 118586,
    year: 2020,
    description: 'A made-up listing that carries an AniList id, to show id matching.',
    chapters: 6,
  },
  { id: 'hello-2', title: 'The Example Chronicles', type: 'manga', year: 2021, description: 'Entirely fictional.', chapters: 12 },
  { id: 'hello-3', title: 'Sample Comic Adventures', type: 'comic', year: 2019, description: 'Entirely fictional.', chapters: 3 },
  { id: 'hello-4', title: 'Placeholder Light Novel', type: 'lnovel', year: 2018, description: 'Entirely fictional.', chapters: 4 },
];

const PALETTES = {
  warm: ['#f2c46d', '#e8875b', '#c75d6b'],
  cool: ['#8fb3ff', '#6bc4c9', '#8a7fd6'],
};

function cover(work) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">'
    + '<rect width="200" height="300" fill="#2a2f45"/>'
    + '<text x="100" y="160" font-size="22" fill="#fff" text-anchor="middle" font-family="sans-serif">'
    + work.id + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function page(work, chapter, index, total, palette) {
  const colors = PALETTES[palette] || PALETTES.warm;
  const fill = colors[index % colors.length];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900">'
    + '<rect width="600" height="900" fill="' + fill + '"/>'
    + '<text x="300" y="420" font-size="40" text-anchor="middle" font-family="sans-serif">'
    + work.title.replace(/[<&>]/g, '') + '</text>'
    + '<text x="300" y="490" font-size="32" text-anchor="middle" font-family="sans-serif">'
    + 'Chapter ' + chapter + ' · page ' + (index + 1) + '/' + total + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findWork(id) {
  const work = WORKS.find(w => w.id === id);
  if (!work) throw new Error('Unknown work ' + id);
  return work;
}

metadea.register({
  sources: {
    hello: {
      async search(query, page) {
        const q = normalize(query);
        const hits = WORKS.filter(w => !q || normalize(w.title).includes(q) || q.includes(normalize(w.title)));
        const size = 20;
        const start = (Math.max(1, page || 1) - 1) * size;
        await metadea.storage.set('lastSearch', { query, at: Date.now() });
        return {
          items: hits.slice(start, start + size).map(w => ({
            id: w.id,
            title: w.title,
            cover: cover(w),
            type: w.type,
            anilistId: w.anilistId,
            year: w.year,
          })),
          hasMore: start + size < hits.length,
        };
      },

      async details(id) {
        const work = findWork(id);
        const chapters = [];
        for (let n = 1; n <= work.chapters; n += 1) {
          chapters.push({
            id: work.id + ':' + n,
            number: n,
            title: 'Chapter ' + n,
            volume: Math.ceil(n / 4),
            date: new Date(Date.UTC(work.year, 0, n)).toISOString().slice(0, 10),
            scanlator: 'Hello Team',
          });
        }
        return {
          id: work.id,
          title: work.title,
          description: work.description,
          cover: cover(work),
          chapters,
        };
      },

      async pages(chapterId) {
        const [workId, number] = String(chapterId).split(':');
        const work = findWork(workId);
        const settings = await metadea.settings.get();
        const total = Number(settings.pagesPerChapter) || 4;
        const reads = (await metadea.storage.get('reads')) || 0;
        await metadea.storage.set('reads', reads + 1);
        return {
          kind: 'images',
          pages: Array.from({ length: total }, (_, i) => ({ url: page(work, Number(number), i, total, settings.palette) })),
        };
      },

      async latest() {
        return { items: WORKS.map(w => ({ itemId: w.id, chapterNumber: w.chapters })) };
      },
    },
  },

  workActions: {
    'say-hello': async work => {
      const settings = await metadea.settings.get();
      return { type: 'toast', message: (settings.greeting || 'Hello') + ', ' + (work.titles[0] || 'reader') + '!' };
    },
  },

  workPanels: {
    'hello-panel': async work => {
      const settings = await metadea.settings.get();
      if (!settings.showPanel) return null;
      const reads = (await metadea.storage.get('reads')) || 0;
      const lastProgress = await metadea.storage.get('progress:' + work.externalId);
      return {
        title: 'Hello Source',
        badges: work.anilistId ? ['AniList #' + work.anilistId] : [],
        rows: [
          { label: 'Type', value: work.type },
          { label: 'Chapters opened here', value: String(reads) },
          { label: 'Last progress event', value: lastProgress ? String(lastProgress.number) : '—' },
        ],
      };
    },
  },

  events: {
    'progress.changed': async payload => {
      await metadea.storage.set('progress:' + payload.externalId, { number: payload.number, at: Date.now() });
      metadea.log.info('progress', payload.externalId, payload.number);
    },
    'session.ended': async payload => {
      metadea.log.info('session ended', payload.kind, payload.externalId);
    },
  },
});
