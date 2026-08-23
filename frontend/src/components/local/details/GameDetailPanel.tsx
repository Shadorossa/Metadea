import React, { useState, useEffect } from 'react';
import {
  readGameInfo, steamGetPlayerAchievements, launchGame, openExternalUrl, startPlaytimeSession,
  type LocalGame, type GameInfo, type SteamAchievement,
  updateDiscordPresence, resetDiscordPresence, getCatalogEntry, getLibraryEntry,
  getMediaRelationsForEditor, igdbGetGameDetail, type MediaCatalogEntry,
} from '../../../lib/tauri';
import { getT } from '../../../i18n/client';
import { AchievementCell } from './AchievementCell';
import { IgdbPickerModal } from '../modals/IgdbPickerModal';
import { CONTAINS_RELATION_TYPES } from '../../../lib/media/sagaTypes';
import { IconX, IconMonitor, IconPencil, IconFolder } from '../ui/icons';
import { formatPlaytime, formatLastPlayed, formatDate } from '../utils/formatters';
import { normalizeForMatch } from '../utils/folderMatch';

export type CoverCache = Record<string, { cover?: string; banner?: string }>;

// Bundle children (see bundleChildren below) label as "Part I"/"Part II"
// instead of their own full title — a bundle's own cover/title already
// names it, so re-printing e.g. "The Great Ace Attorney 2: Resolve" in full
// under a 64px thumbnail just wraps into an unreadable mess.
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function toRoman(n: number): string {
  return ROMAN_NUMERALS[n - 1] ?? String(n);
}

interface GameDetailPanelProps {
  game:           LocalGame;
  coverCache:     CoverCache;
  onClose:        () => void;
  onMetaRefresh?: () => void;
  // Set when this panel is opened for a catalog-tracked "Pendiente" entry
  // that isn't actually a scanned Steam/Epic/... install (no app_id to
  // resolve an igdb_id from) — the real external_id is already known from
  // the library/catalog row itself, so catalogEntry/relations resolve
  // directly from it instead of guessing via readGameInfo(app_id).
  knownExternalId?: string;
  // Same reasoning for the header art — coverCache is keyed by app_id,
  // which a non-Steam pending entry doesn't have; falls back to whatever
  // cover the catalog entry itself already has.
  fallbackCover?: string | null;
  // Set when `game` is a season/update tracked separately from its source
  // (see LocalLibrary's sourceCatalogOf) — everything about actually
  // PLAYING this (launch, achievements, playtime, last-played, cached
  // cover/banner) comes from this real installed game instead, while the
  // title/cover/catalog identity shown still stays the season's own.
  launchOverride?: LocalGame;
}

export function GameDetailPanel({ game, coverCache, onClose, onMetaRefresh, knownExternalId, fallbackCover, launchOverride }: GameDetailPanelProps) {
  const t = getT();
  const launchTarget = launchOverride ?? game;
  // Identifies which selection this render is actually showing — used only
  // to `key` the content below (see the JSX further down), so switching to
  // a different game/pending item while the panel stays open cross-fades
  // its content smoothly instead of the new data popping in field-by-field
  // as each async fetch resolves (a flicker, since the panel itself no
  // longer unmounts/remounts on selection changes).
  const contentKey = knownExternalId ?? game.app_id ?? game.name;
  const [gameInfo,      setGameInfo]      = useState<GameInfo | null>(null);
  const [achievements,  setAchievements]  = useState<{ unlocked: number; total: number; list: SteamAchievement[] } | null>(null);
  const [showPicker,    setShowPicker]    = useState(false);
  const [hasLaunched,   setHasLaunched]   = useState(false);

  useEffect(() => {
    return () => {
      if (hasLaunched) {
        resetDiscordPresence().catch(() => {});
      }
    };
  }, [hasLaunched]);

  useEffect(() => {
    // Reset unconditionally first — without this, switching from a season
    // whose source game DOES have cached info (summary/genres/developers)
    // to one with none left the previous game's info on screen instead of
    // clearing, since the early return below never touched gameInfo at all.
    setGameInfo(null);
    if (!launchTarget.app_id) return;
    let cancelled = false;
    readGameInfo(launchTarget.app_id).then(info => { if (!cancelled) setGameInfo(info); });
    return () => { cancelled = true; };
  }, [launchTarget.app_id]);

  useEffect(() => {
    setAchievements(null);
    if (launchTarget.launcher !== 'steam' || !launchTarget.app_id) return;
    let cancelled = false;
    steamGetPlayerAchievements(Number(launchTarget.app_id)).then(res => { if (!cancelled) setAchievements(res || null); });
    return () => { cancelled = true; };
  }, [launchTarget.app_id, launchTarget.launcher]);

  // A "Pendiente" entry with no scanned install anywhere might still be
  // buyable/viewable on some storefront — IGDB's own external_games links
  // (the same ones the /media page's own store-link row already surfaces)
  // tell us that even without owning it. Only worth checking for
  // knownExternalId entries: an actually-scanned game already IS its own
  // listing. Prefers Steam when both exist (steam:// opens inside the
  // client itself, a nicer experience than a plain web storefront link).
  const [storeLink, setStoreLink] = useState<{ platform: string; url: string } | null>(null);
  // "by X" for a catalog-only entry with no matched Steam install at all —
  // gameInfo (below) only ever comes from a real app_id's cached
  // info.json, which doesn't exist here, so the developer name has nowhere
  // else to come from but a live IGDB lookup (same call already made for
  // storeLink, just also reading its involved_companies this time).
  const [catalogDevelopers, setCatalogDevelopers] = useState<string[] | null>(null);
  // Gates the Nintendo eShop search fallback below — a game merely running
  // ON a Nintendo platform (any third-party Switch release) isn't what
  // "Ver en Nintendo" should mean; only when Nintendo itself is the
  // publisher or developer.
  const [isNintendoCompany, setIsNintendoCompany] = useState(false);
  useEffect(() => {
    setStoreLink(null);
    setCatalogDevelopers(null);
    setIsNintendoCompany(false);
    if (!knownExternalId) return;
    const igdbId = Number(knownExternalId.split(':')[1]);
    if (!igdbId) return;
    let cancelled = false;
    igdbGetGameDetail(igdbId).then(detail => {
      if (cancelled || !detail) return;
      const links = detail.store_links as { platform: string; url: string }[] | undefined;
      const picked = links?.find(l => l.platform === 'steam') ?? links?.[0];
      if (picked) {
        if (picked.platform === 'steam') {
          // steam:// opens the store page inside the Steam client itself
          // instead of the browser — Steam's own app-page URLs are always
          // ".../app/<id>/...", so the numeric id is all this needs.
          const appIdMatch = picked.url.match(/\/app\/(\d+)/);
          setStoreLink({ platform: 'steam', url: appIdMatch ? `steam://store/${appIdMatch[1]}` : picked.url });
        } else {
          setStoreLink(picked);
        }
      }
      const companies = detail.involved_companies as { company?: { name?: string }; developer?: boolean; publisher?: boolean }[] | undefined;
      const developers = companies?.filter(c => c.developer && c.company?.name).map(c => c.company!.name!);
      if (developers && developers.length > 0) setCatalogDevelopers(developers);
      setIsNintendoCompany(!!companies?.some(c => (c.developer || c.publisher) && c.company?.name?.toLowerCase().includes('nintendo')));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [knownExternalId]);
  const STORE_LABELS: Record<string, string> = {
    steam: t.local.view_on_steam,
    nintendo: t.local.view_on_nintendo,
  };

  const [catalogEntry,  setCatalogEntry]  = useState<MediaCatalogEntry | null>(null);

  // Tries both id prefixes — an IGDB game logged as a visual novel is
  // catalogued as "vnovel:<id>", not "game:<id>" (see detect_vn/is_vn), and
  // only one of the two lookups will ever actually resolve. Guessing "game:"
  // alone silently missed every VN, which is exactly what made this panel's
  // own PREQUEL/SEQUEL lookup below come up empty for e.g. Higurashi.
  useEffect(() => {
    if (knownExternalId) {
      getCatalogEntry(knownExternalId).then(setCatalogEntry).catch(() => setCatalogEntry(null));
      return;
    }
    if (!gameInfo?.igdb_id) { setCatalogEntry(null); return; }
    const igdbId = gameInfo.igdb_id;
    Promise.all([
      getCatalogEntry(`game:${igdbId}`).catch(() => null),
      getCatalogEntry(`vnovel:${igdbId}`).catch(() => null),
    ]).then(([g, v]) => setCatalogEntry(g ?? v ?? null));
  }, [gameInfo?.igdb_id, knownExternalId]);

  // Same prequel/sequel neighbor row LocalMediaDetailPanel shows for
  // anime/manga/etc. — a Steam game's real catalog identity is whatever
  // getCatalogEntry above actually resolved (falls back to "game:<id>" only
  // when that lookup found nothing, e.g. before it resolves on first mount).
  const [prequelInfo, setPrequelInfo] = useState<{ externalId: string; title: string; cover: string | null } | null>(null);
  const [sequelInfo, setSequelInfo] = useState<{ externalId: string; title: string; cover: string | null } | null>(null);
  // A bundle (e.g. The Great Ace Attorney Chronicles) has no PREQUEL/SEQUEL
  // of its own — its catalog entry instead CONTAINS the individual episodes
  // (The Great Ace Attorney / 2: Resolve). Same neighbor row, just showing
  // "what's inside this bundle" instead of "what comes before/after it".
  const [bundleChildren, setBundleChildren] = useState<{ externalId: string; title: string; cover: string | null }[]>([]);
  const relationsExternalId = catalogEntry?.external_id ?? knownExternalId ?? (gameInfo?.igdb_id ? `game:${gameInfo.igdb_id}` : undefined);
  useEffect(() => {
    setPrequelInfo(null);
    setSequelInfo(null);
    setBundleChildren([]);
    if (!relationsExternalId) return;
    let cancelled = false;
    getMediaRelationsForEditor(relationsExternalId).then(async relations => {
      if (cancelled) return;
      const children = relations.filter(r => CONTAINS_RELATION_TYPES.includes(r.relation_type));
      if (children.length > 0) {
        setBundleChildren(children.map(c => ({ externalId: c.related_media_external_id, title: c.title, cover: c.cover ?? null })));
        return;
      }
      let prequel = relations.find(r => r.relation_type === 'PREQUEL');
      let sequel = relations.find(r => r.relation_type === 'SEQUEL');
      // A remaster/remake never carries its own PREQUEL/SEQUEL/CONTAINS —
      // those live on the original it's an edition of (see PARENT, the
      // reverse-direction label REMASTER/REMAKE gets recorded under on the
      // edition's own side). Same "borrow the original's saga identity"
      // fallback library-grouping.ts's refineSagaGroups already relies on
      // for the profile grid, applied here for this neighbor row too — and,
      // like that same code, the neighbor itself gets swapped for ITS OWN
      // remaster/remake edition when one exists (a Hou remaster's sequel
      // should point at the next chapter's own Hou remaster, not the bare
      // original release), falling back to the original only when it has
      // no edition of its own.
      let viaParent = false;
      // Which edition family this entry itself belongs to (REMASTER vs
      // REMAKE) — a base work can have both (Higurashi has its Hou remaster
      // AND its separate Matsuri remake), so the neighbor lookup below needs
      // to match the SAME family, not just grab whichever edition happens
      // to come back first.
      let selfEditionType: string | undefined;
      if (!prequel && !sequel) {
        const parent = relations.find(r => r.relation_type === 'PARENT');
        if (parent) {
          const parentRelations = await getMediaRelationsForEditor(parent.related_media_external_id).catch(() => []);
          if (cancelled) return;
          prequel = parentRelations.find(r => r.relation_type === 'PREQUEL');
          sequel = parentRelations.find(r => r.relation_type === 'SEQUEL');
          viaParent = true;
          selfEditionType = parentRelations.find(r => r.related_media_external_id === relationsExternalId)?.relation_type;
        }
      }
      // Self's own title, tokenized once — used below to pick the right one
      // out of SEVERAL same-type editions of the same neighbor (e.g. an EN
      // and a JP remaster both existing for the same base game), since
      // relation_type alone (REMASTER/REMAKE) can't tell those apart.
      const selfTokens = new Set(normalizeForMatch(game.name).split(' ').filter(Boolean));
      const bestByTitleOverlap = (candidates: typeof relations) => candidates.reduce((best, c) => {
        const score = normalizeForMatch(c.title).split(' ').filter(tok => tok && selfTokens.has(tok)).length;
        return !best || score > best.score ? { rel: c, score } : best;
      }, undefined as { rel: (typeof relations)[number]; score: number } | undefined)?.rel;
      const resolveNeighbor = async (rel: NonNullable<typeof prequel>) => {
        if (!viaParent) return { externalId: rel.related_media_external_id, title: rel.title, cover: rel.cover ?? null };
        const neighborRelations = await getMediaRelationsForEditor(rel.related_media_external_id).catch(() => []);
        const editionTypes = ['REMASTER', 'REMAKE'];
        const orderedTypes = selfEditionType ? [selfEditionType, ...editionTypes.filter(t => t !== selfEditionType)] : editionTypes;
        let edition: (typeof relations)[number] | undefined;
        for (const t of orderedTypes) {
          const candidates = neighborRelations.filter(r => r.relation_type === t);
          if (candidates.length === 1) { edition = candidates[0]; break; }
          if (candidates.length > 1) { edition = bestByTitleOverlap(candidates); break; }
        }
        return edition
          ? { externalId: edition.related_media_external_id, title: edition.title, cover: edition.cover ?? null }
          : { externalId: rel.related_media_external_id, title: rel.title, cover: rel.cover ?? null };
      };
      if (prequel) setPrequelInfo(await resolveNeighbor(prequel));
      if (cancelled) return;
      if (sequel) setSequelInfo(await resolveNeighbor(sequel));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [relationsExternalId]);

  const openMediaEditor = (externalId: string) => {
    window.dispatchEvent(new CustomEvent('open-profile-editor', { detail: { externalId } }));
  };

  // Identity (banner/cover, metadata) always stays `game`'s own — a season
  // shows ITS OWN art/summary/genres ("estás jugando la season de X"), not
  // its source's. Only the actually-playable bits (launch, achievements,
  // playtime/last-played — see launchTarget's own uses below) come from the
  // source instead.
  const entry      = game.app_id ? coverCache[game.app_id] : undefined;
  // A non-Steam entry (no coverCache banner at all) still has real banner
  // art if the catalog row itself carries one (banners_csv, same field
  // LocalMediaDetailPanel's own header already reads) — checked before
  // falling all the way back to the portrait cover_url.
  const catalogBanner = catalogEntry?.banners_csv?.split(',')[0]?.trim() || null;
  const banner     = entry?.banner ?? catalogBanner ?? entry?.cover ?? fallbackCover ?? null;
  // A real downloaded banner (Steam-cached, or the catalog's own
  // banners_csv art) is already a wide, header-shaped image — safe to
  // crop-cover the full width. Falling back to a portrait cover (no banner
  // at all, just a box-art cover_url) stretched the exact same way looked
  // pixelated/blown-up, since a cover is nowhere near wide enough
  // natively. Those get a blurred-backdrop + contained-foreground
  // treatment instead (see the header JSX below).
  const isRealBanner = !!entry?.banner || !!catalogBanner;
  // IGDB's external_games has no Nintendo eShop category at all (verified
  // against its own ExternalGameCategory enum — steam/gog/microsoft/apple/
  // android/amazon/epic/oculus/itch/xbox/playstation/gamejolt/..., nothing
  // Nintendo), so storeLink above can never resolve one from real data.
  // Best-effort substitute: a search link into the eShop by title — but only
  // when Nintendo is actually the developer or publisher, not merely a
  // platform the game happens to run on (a third-party Switch release
  // shouldn't get sent to Nintendo's own storefront).
  const isNintendoCompanyName = (names?: string[]) => !!names?.some(n => n.toLowerCase().includes('nintendo'));
  const isNintendo = isNintendoCompany
    || isNintendoCompanyName(gameInfo?.developers)
    || isNintendoCompanyName(gameInfo?.publishers);
  const effectiveStoreLink = storeLink ?? (isNintendo
    ? { platform: 'nintendo', url: `https://www.nintendo.com/us/search/?q=${encodeURIComponent(game.name)}` }
    : null);
  const effectiveStoreLinkLabel = effectiveStoreLink
    ? (STORE_LABELS[effectiveStoreLink.platform]
      ?? t.local.view_on_store.replace('{platform}', effectiveStoreLink.platform.charAt(0).toUpperCase() + effectiveStoreLink.platform.slice(1)))
    : undefined;
  // A "Pendiente" entry with no real Steam/Epic/... install has nothing to
  // launch — the button still shows (same layout every other game gets)
  // but disabled, instead of silently failing a launchGame call with no
  // app_id/install_path.
  const canLaunch  = !!launchTarget.app_id || !!launchTarget.install_path;
  // Same "own identity, not the source's" reasoning as the banner above —
  // the catalog entry's own release date/genres/synopsis (this identity's
  // real data) win over gameInfo (which is actually launchTarget's cached
  // info, only relevant here for a plain game with no separate identity to
  // begin with, where game === launchTarget anyway).
  const catalogReleaseTimestamp = catalogEntry?.release_year
    ? Math.floor(new Date(catalogEntry.release_year, (catalogEntry.release_month ?? 1) - 1, catalogEntry.release_day ?? 1).getTime() / 1000)
    : undefined;
  const displayGenres = catalogEntry?.genres_csv
    ? catalogEntry.genres_csv.split(',').map(g => g.trim()).filter(Boolean).join(', ')
    : gameInfo?.genres?.join(', ');
  const metaDots   = [formatDate(catalogReleaseTimestamp ?? gameInfo?.release_date ?? undefined), displayGenres].filter(Boolean).join('  ·  ');
  const displaySummary = catalogEntry?.synopsis || gameInfo?.summary;

  const handleEdit = () => {
    if (!relationsExternalId) return;
    const externalId = relationsExternalId;
    getLibraryEntry(externalId)
      .then(libraryEntry => {
        window.dispatchEvent(new CustomEvent('open-profile-editor', {
          detail: { externalId, libraryEntry: libraryEntry ?? undefined, catalogEntry: catalogEntry ?? undefined },
        }));
      })
      .catch(console.error);
  };

  return (
    <div className="local-game-detail-panel">
      <div className="local-game-detail-header">
        <button className="local-game-detail-back" onClick={onClose} title={t.local.close_panel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        {banner ? (
          isRealBanner ? (
            <img src={banner} alt={game.name} />
          ) : (
            <>
              <img className="local-game-detail-header-blur" src={banner} alt="" aria-hidden="true" />
              <img className="local-game-detail-header-contain" src={banner} alt={game.name} />
            </>
          )
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)' }}>
            <IconMonitor />
          </div>
        )}
        <div className="local-game-detail-backdrop" />
        {launchTarget.launcher === 'steam' && launchTarget.app_id && (
          <button className="local-game-detail-edit" onClick={() => setShowPicker(true)} title={t.local.change_igdb_game}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
        <button className="local-game-detail-close" onClick={onClose}><IconX /></button>
      </div>

      {showPicker && (
        <IgdbPickerModal
          game={launchTarget}
          onClose={() => setShowPicker(false)}
          onPicked={() => onMetaRefresh?.()}
        />
      )}

      <div className="local-game-detail-content" key={contentKey}>
        <div className="local-game-detail-sticky-bar">
        <div className="local-game-detail-title-block">
          <div className="local-media-detail-top-row">
            <p className="local-game-detail-title">{game.name}</p>
            {relationsExternalId && (
              <div className="local-media-detail-icon-actions">
                <button type="button" className="local-media-detail-edit-icon" onClick={handleEdit} title={t.local.edit_catalog_log}>
                  <IconPencil />
                </button>
                <a href={`/media?id=${relationsExternalId}`} className="local-game-detail-catalog-link">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  Ver en catálogo
                </a>
              </div>
            )}
          </div>
          {(() => {
            // catalogDevelopers (this identity's own IGDB lookup) wins over
            // gameInfo.developers (launchTarget's cached info) — same "own
            // identity" reasoning as the banner/metaDots above. Only ever
            // both populated at once for a season, where they'd otherwise
            // show the source's studio under the season's own name.
            const developers = (catalogDevelopers && catalogDevelopers.length > 0) ? catalogDevelopers : gameInfo?.developers;
            const hasDevelopers = !!developers && developers.length > 0;
            return (
              <p className={`local-game-detail-by${hasDevelopers ? ' local-game-detail-by--visible' : ''}`}>
                {hasDevelopers ? `by ${developers!.join(', ')}` : ' '}
              </p>
            );
          })()}
        </div>

        <div className={`local-media-info-row${(prequelInfo || sequelInfo || bundleChildren.length > 0) ? ' local-media-info-row--has-neighbors' : ''}`}>
          <div className="local-media-left-col">
            <button
              className="local-game-detail-play"
              disabled={!canLaunch && !effectiveStoreLink}
              title={canLaunch || effectiveStoreLink ? undefined : t.local.not_installed}
              onClick={() => {
                if (!canLaunch) {
                  // Nothing to launch, but it IS buyable/viewable somewhere
                  // (a real store link, or the Nintendo eShop search
                  // fallback — see effectiveStoreLink above) — opened the
                  // same way regardless (steam:// or a plain https url).
                  if (effectiveStoreLink) openExternalUrl(effectiveStoreLink.url).catch(console.error);
                  return;
                }
                launchGame(launchTarget.launcher, launchTarget.app_id, launchTarget.install_path)
                  .then(() => {
                    setHasLaunched(true);
                    const startTime = Math.floor(Date.now() / 1000);
                    const coverUrl = (catalogEntry?.cover_url && catalogEntry.cover_url.startsWith('http'))
                      ? catalogEntry.cover_url
                      : (banner && banner.startsWith('http'))
                      ? banner
                      : undefined;
                    updateDiscordPresence(`Playing ${game.name}`, "", startTime, undefined, coverUrl, game.name, "metadea", "Metadea").catch(() => {});
                    // Auto-logs hours on exit (see LocalLibrary's
                    // game-session-ended listener) — keyed by launchTarget's
                    // OWN identity (the source game for a season, never the
                    // season's own display id) since that's whose library
                    // entry actually tracks hours played. Tried against both
                    // id prefixes since an IGDB game logged as a visual
                    // novel is catalogued as "vnovel:<id>", not "game:<id>".
                    if (launchTarget.install_path) {
                      const resolveSourceExternalId = async (): Promise<string | undefined> => {
                        if (launchTarget.external_id) return launchTarget.external_id;
                        if (!gameInfo?.igdb_id) return undefined;
                        for (const candidate of [`game:${gameInfo.igdb_id}`, `vnovel:${gameInfo.igdb_id}`]) {
                          if (await getLibraryEntry(candidate).catch(() => null)) return candidate;
                        }
                        return undefined;
                      };
                      resolveSourceExternalId().then(id => {
                        if (id) startPlaytimeSession(launchTarget.install_path!, id).catch(() => {});
                      });
                    }
                  })
                  .catch(console.error);
              }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {canLaunch ? 'Jugar' : effectiveStoreLinkLabel ?? t.local.not_installed}
            </button>

            <div className="local-media-divider-line" />

            <div className="local-game-detail-bottom">
              <div className="local-game-detail-stats">
                <div className="local-game-detail-stat">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>{formatPlaytime(launchTarget.playtime_minutes)}</span>
                  <span className="local-game-detail-stat-label">{t.local.stat_time}</span>
                </div>
                <div className="local-game-detail-stat">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span>{formatLastPlayed(launchTarget.last_played)}</span>
                  <span className="local-game-detail-stat-label">{t.local.stat_last_played}</span>
                </div>
                <div className="local-game-detail-stat">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/>
                    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                    <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
                  </svg>
                  <span>{achievements ? `${achievements.unlocked}/${achievements.total}` : '—'}</span>
                  <span className="local-game-detail-stat-label">{t.local.stat_achievements}</span>
                </div>
              </div>
            </div>
          </div>

          {bundleChildren.length > 0 ? (
            <div className="local-media-neighbors-row">
              <div className="local-media-neighbors-grid">
                {bundleChildren.map((child, i) => (
                  <button key={child.externalId} type="button" className="local-media-neighbor-link" title={child.title} onClick={() => openMediaEditor(child.externalId)}>
                    {child.cover
                      ? <img className="local-media-neighbor-cover" src={child.cover} alt={child.title} />
                      : <div className="local-media-neighbor-cover local-media-neighbor-cover--fallback"><IconFolder size={20} strokeWidth={2} /></div>}
                    <span className="local-media-neighbor-label">Part {toRoman(i + 1)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (prequelInfo || sequelInfo) && (
            <div className="local-media-neighbors-row">
              <div className="local-media-neighbors-grid">
                {prequelInfo && (
                  <button type="button" className="local-media-neighbor-link" title={prequelInfo.title} onClick={() => openMediaEditor(prequelInfo.externalId)}>
                    {prequelInfo.cover
                      ? <img className="local-media-neighbor-cover" src={prequelInfo.cover} alt={prequelInfo.title} />
                      : <div className="local-media-neighbor-cover local-media-neighbor-cover--fallback"><IconFolder size={20} strokeWidth={2} /></div>}
                    <span className="local-media-neighbor-label">Precuela</span>
                  </button>
                )}
                {sequelInfo && (
                  <button type="button" className="local-media-neighbor-link" title={sequelInfo.title} onClick={() => openMediaEditor(sequelInfo.externalId)}>
                    {sequelInfo.cover
                      ? <img className="local-media-neighbor-cover" src={sequelInfo.cover} alt={sequelInfo.title} />
                      : <div className="local-media-neighbor-cover local-media-neighbor-cover--fallback"><IconFolder size={20} strokeWidth={2} /></div>}
                    <span className="local-media-neighbor-label">Secuela</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        </div>

        <p className={`local-game-detail-metadots${metaDots ? ' local-game-detail-metadots--visible' : ''}`}>{metaDots || ' '}</p>
        {displaySummary && <p className="local-game-detail-summary">{displaySummary}</p>}

        {achievements?.list && achievements.list.length > 0 && (
          <div className="local-game-detail-achievements">
            <p className="local-game-detail-achievements-title">
              Logros — {achievements.unlocked}/{achievements.total}
            </p>
            <div className="local-game-detail-achievement-grid">
              {achievements.list.map((ach: SteamAchievement) => (
                <AchievementCell key={ach.apiname} ach={ach} appId={launchTarget.app_id!} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
