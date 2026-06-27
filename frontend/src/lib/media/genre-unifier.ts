// Central genre/tag unifier for all media APIs.
// Each entry defines a unified name, whether it's a secondary tag,
// and all the raw strings from any API that should map to it.
//
//   core  = main genre filter (shown prominently, used for library filters)
//   tag   = secondary theme (more specific, less prominent)

interface GenreDef {
  name: string;
  isTag?: boolean;
  aliases: string[];
}

const GENRE_DEFS: GenreDef[] = [
  // ── Action / Combat ──────────────────────────────────────────────────────
  { name: 'Action',            aliases: ['Action', 'Action & Adventure'] },
  { name: 'Fighting',          aliases: ['Fighting'] },
  { name: 'Hack and Slash',    aliases: ["Hack and slash/Beat 'em up", 'Hack and Slash', 'Beat \'em up'] },
  { name: 'Shooter',           aliases: ['Shooter'] },

  // ── Adventure ────────────────────────────────────────────────────────────
  { name: 'Adventure',         aliases: ['Adventure'] },
  { name: 'Point-and-click',   aliases: ['Point-and-click'],              isTag: true },

  // ── Strategy ─────────────────────────────────────────────────────────────
  { name: 'Strategy',          aliases: ['Strategy'] },
  { name: 'Real Time Strategy', aliases: ['Real Time Strategy (RTS)', 'Real Time Strategy', 'RTS'] },
  { name: 'Turn-based Strategy', aliases: ['Turn-based strategy (TBS)', 'Turn-based Strategy', 'TBS'] },
  { name: 'Tactical',          aliases: ['Tactical'] },
  { name: '4X',                aliases: ['4X'],                           isTag: true },

  // ── RPG ──────────────────────────────────────────────────────────────────
  { name: 'RPG',               aliases: ['Role-playing (RPG)', 'RPG', 'Role-Playing'] },

  // ── Platformer / Puzzle / Arcade ─────────────────────────────────────────
  { name: 'Platformer',        aliases: ['Platform', 'Platformer'] },
  { name: 'Puzzle',            aliases: ['Puzzle'] },
  { name: 'Arcade',            aliases: ['Arcade'] },

  // ── Simulation / Sports ──────────────────────────────────────────────────
  { name: 'Simulation',        aliases: ['Simulator', 'Simulation'] },
  { name: 'Sports',            aliases: ['Sport', 'Sports'] },
  { name: 'Racing',            aliases: ['Racing'] },

  // ── Multiplayer / Social ─────────────────────────────────────────────────
  { name: 'MOBA',              aliases: ['MOBA'] },
  { name: 'Party',             aliases: ['Party'],                        isTag: true },

  // ── Narrative / Visual ───────────────────────────────────────────────────
  { name: 'Visual Novel',      aliases: ['Visual Novel'] },
  { name: 'Card & Board Game', aliases: ['Card & Board Game'] },
  { name: 'Music',             aliases: ['Music'] },
  { name: 'Quiz/Trivia',       aliases: ['Quiz / Trivia', 'Quiz/Trivia'], isTag: true },

  // ── Open world / Survival ────────────────────────────────────────────────
  { name: 'Sandbox',           aliases: ['Sandbox'],                      isTag: true },
  { name: 'Open world',        aliases: ['Open world'],                   isTag: true },
  { name: 'Survival',          aliases: ['Survival'],                     isTag: true },
  { name: 'Stealth',           aliases: ['Stealth'],                      isTag: true },

  // ── Genres (cross-media) ─────────────────────────────────────────────────
  { name: 'Fantasy',           aliases: ['Fantasy', 'Sci-Fi & Fantasy'] },
  { name: 'Sci-Fi',            aliases: ['Science fiction', 'Science Fiction', 'Sci-Fi'] },
  { name: 'Horror',            aliases: ['Horror'] },
  { name: 'Thriller',          aliases: ['Thriller'] },
  { name: 'Mystery',           aliases: ['Mystery'] },
  { name: 'Romance',           aliases: ['Romance'] },
  { name: 'Comedy',            aliases: ['Comedy'] },
  { name: 'Drama',             aliases: ['Drama'] },
  { name: 'History',           aliases: ['Historical', 'History'] },
  { name: 'War',               aliases: ['War', 'Warfare'] },
  { name: 'Western',           aliases: ['Western'] },
  { name: 'Crime',             aliases: ['Crime'] },
  { name: 'Animation',         aliases: ['Animation'] },
  { name: 'Documentary',       aliases: ['Documentary'] },
  { name: 'Family',            aliases: ['Family'] },

  // ── Aesthetic subgenres ──────────────────────────────────────────────────
  { name: 'Cyberpunk',         aliases: ['Cyberpunk'] },
  { name: 'Steampunk',         aliases: ['Steampunk'] },

  // ── Anime-specific (AniList) ─────────────────────────────────────────────
  { name: 'Slice of Life',     aliases: ['Slice of Life'] },
  { name: 'Supernatural',      aliases: ['Supernatural'] },
  { name: 'Psychological',     aliases: ['Psychological'] },
  { name: 'Mecha',             aliases: ['Mecha'] },
  { name: 'Mahou Shoujo',      aliases: ['Mahou Shoujo'] },
  { name: 'Ecchi',             aliases: ['Ecchi'],                        isTag: true },
  { name: 'Harem',             aliases: ['Harem'],                        isTag: true },
  { name: 'Isekai',            aliases: ['Isekai'],                       isTag: true },

  // ── Misc tags ────────────────────────────────────────────────────────────
  { name: 'Indie',             aliases: ['Indie'],                        isTag: true },
  { name: 'Educational',       aliases: ['Educational'],                  isTag: true },
  { name: 'Kids',              aliases: ['Kids'],                         isTag: true },
  { name: 'Business',          aliases: ['Business'],                     isTag: true },
  { name: 'Non-fiction',       aliases: ['Non-fiction'],                  isTag: true },
  { name: 'Erotic',            aliases: ['Erotic'],                       isTag: true },
];

// Build flat lookup map at module load time
const RAW_TO_UNIFIED: Record<string, { name: string; isTag: boolean }> =
  Object.fromEntries(
    GENRE_DEFS.flatMap(({ name, isTag, aliases }) =>
      aliases.map(alias => [alias, { name, isTag: isTag ?? false }])
    )
  );

export interface SplitGenres {
  core: string[];
  tags: string[];
}

/** Convert raw genre strings from any API into unified core genres and tags. */
export function unifyGenres(rawGenres: string[]): SplitGenres {
  const core: string[] = [];
  const tags: string[] = [];

  for (const raw of rawGenres) {
    const entry = RAW_TO_UNIFIED[raw];
    if (!entry) continue;
    if (entry.isTag) {
      if (!tags.includes(entry.name)) tags.push(entry.name);
    } else {
      if (!core.includes(entry.name)) core.push(entry.name);
    }
  }

  return { core, tags };
}
