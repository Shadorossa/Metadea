// Central genre/tag unifier for all media APIs.
// Maps raw genre strings (from IGDB, AniList, TMDB, Open Library) to a
// canonical unified name and classifies them as core genre or secondary tag.
//
// Convention:
//   core  = main genre filter (shown prominently, used for library filters)
//   tag   = secondary theme (more specific, less prominent)

interface GenreEntry {
  name: string;
  isTag?: boolean;
}

const RAW_TO_UNIFIED: Record<string, GenreEntry> = {
  // ── Action / Combat ──────────────────────────────────────────────────────
  'Action':                          { name: 'Action' },
  'Fighting':                        { name: 'Fighting' },
  "Hack and slash/Beat 'em up":      { name: 'Hack and Slash' },
  'Hack and Slash':                  { name: 'Hack and Slash' },
  'Shooter':                         { name: 'Shooter' },

  // ── Adventure ────────────────────────────────────────────────────────────
  'Adventure':                       { name: 'Adventure' },
  'Point-and-click':                 { name: 'Point-and-click', isTag: true },

  // ── Strategy ─────────────────────────────────────────────────────────────
  'Strategy':                        { name: 'Strategy' },
  'Real Time Strategy (RTS)':        { name: 'Real Time Strategy' },
  'Real Time Strategy':              { name: 'Real Time Strategy' },
  'Turn-based strategy (TBS)':       { name: 'Turn-based Strategy' },
  'Turn-based Strategy':             { name: 'Turn-based Strategy' },
  'Tactical':                        { name: 'Tactical' },
  '4X':                              { name: '4X', isTag: true },

  // ── RPG ──────────────────────────────────────────────────────────────────
  'Role-playing (RPG)':              { name: 'RPG' },
  'RPG':                             { name: 'RPG' },

  // ── Platformer / Puzzle / Arcade ─────────────────────────────────────────
  'Platform':                        { name: 'Platformer' },
  'Platformer':                      { name: 'Platformer' },
  'Puzzle':                          { name: 'Puzzle' },
  'Arcade':                          { name: 'Arcade' },

  // ── Simulation / Sports ──────────────────────────────────────────────────
  'Simulator':                       { name: 'Simulation' },
  'Simulation':                      { name: 'Simulation' },
  'Sport':                           { name: 'Sports' },
  'Sports':                          { name: 'Sports' },
  'Racing':                          { name: 'Racing' },

  // ── Multiplayer / Social ─────────────────────────────────────────────────
  'MOBA':                            { name: 'MOBA' },
  'Party':                           { name: 'Party', isTag: true },

  // ── Narrative / Visual ───────────────────────────────────────────────────
  'Visual Novel':                    { name: 'Visual Novel' },
  'Card & Board Game':               { name: 'Card & Board Game' },
  'Music':                           { name: 'Music' },
  'Quiz / Trivia':                   { name: 'Quiz/Trivia', isTag: true },
  'Quiz/Trivia':                     { name: 'Quiz/Trivia', isTag: true },

  // ── Open world / Survival ────────────────────────────────────────────────
  'Sandbox':                         { name: 'Sandbox', isTag: true },
  'Open world':                      { name: 'Open world', isTag: true },
  'Survival':                        { name: 'Survival', isTag: true },
  'Stealth':                         { name: 'Stealth', isTag: true },

  // ── Genres (cross-media) ─────────────────────────────────────────────────
  'Fantasy':                         { name: 'Fantasy' },
  'Science fiction':                 { name: 'Sci-Fi' },
  'Science Fiction':                 { name: 'Sci-Fi' },
  'Sci-Fi':                          { name: 'Sci-Fi' },
  'Horror':                          { name: 'Horror' },
  'Thriller':                        { name: 'Thriller' },
  'Mystery':                         { name: 'Mystery' },
  'Romance':                         { name: 'Romance' },
  'Comedy':                          { name: 'Comedy' },
  'Drama':                           { name: 'Drama' },
  'Action & Adventure':              { name: 'Action' },   // TMDB TV
  'Sci-Fi & Fantasy':                { name: 'Fantasy' },  // TMDB TV (split intentional: Fantasy takes priority)
  'Historical':                      { name: 'History' },
  'History':                         { name: 'History' },
  'War':                             { name: 'War' },
  'Warfare':                         { name: 'War' },
  'Western':                         { name: 'Western' },
  'Crime':                           { name: 'Crime' },
  'Animation':                       { name: 'Animation' },
  'Documentary':                     { name: 'Documentary' },
  'Family':                          { name: 'Family' },

  // ── Aesthetic subgenres ──────────────────────────────────────────────────
  'Cyberpunk':                       { name: 'Cyberpunk' },
  'Steampunk':                       { name: 'Steampunk' },

  // ── Anime-specific (AniList) ─────────────────────────────────────────────
  'Slice of Life':                   { name: 'Slice of Life' },
  'Supernatural':                    { name: 'Supernatural' },
  'Psychological':                   { name: 'Psychological' },
  'Mecha':                           { name: 'Mecha' },
  'Mahou Shoujo':                    { name: 'Mahou Shoujo' },
  'Ecchi':                           { name: 'Ecchi', isTag: true },
  'Harem':                           { name: 'Harem', isTag: true },
  'Isekai':                          { name: 'Isekai', isTag: true },
  'Sports':                          { name: 'Sports' },

  // ── Misc tags ────────────────────────────────────────────────────────────
  'Indie':                           { name: 'Indie', isTag: true },
  'Educational':                     { name: 'Educational', isTag: true },
  'Kids':                            { name: 'Kids', isTag: true },
  'Business':                        { name: 'Business', isTag: true },
  'Non-fiction':                     { name: 'Non-fiction', isTag: true },
  'Erotic':                          { name: 'Erotic', isTag: true },
};

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
