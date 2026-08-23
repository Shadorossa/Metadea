import React, { useState, useEffect } from 'react';
import {
  readGameInfo, steamGetPlayerAchievements, launchGame,
  type LocalGame, type GameInfo, type SteamAchievement,
  updateDiscordPresence, resetDiscordPresence, getCatalogEntry, getLibraryEntry,
  getMediaRelationsForEditor, type MediaCatalogEntry,
} from '../../../lib/tauri';
import { getT } from '../../../i18n/client';
import { AchievementCell } from './AchievementCell';
import { IgdbPickerModal } from '../modals/IgdbPickerModal';
import { CONTAINS_RELATION_TYPES } from '../../../lib/media/sagaTypes';
import { IconX, IconMonitor, IconPencil, IconFolder } from '../ui/icons';
import { formatPlaytime, formatLastPlayed, formatDate } from '../utils/formatters';

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
}

export function GameDetailPanel({ game, coverCache, onClose, onMetaRefresh }: GameDetailPanelProps) {
  const t = getT();
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
    if (!game.app_id) return;
    readGameInfo(game.app_id).then(setGameInfo);
  }, [game.app_id]);

  useEffect(() => {
    if (game.launcher !== 'steam' || !game.app_id) { setAchievements(null); return; }
    steamGetPlayerAchievements(Number(game.app_id)).then(res => setAchievements(res || null));
  }, [game.app_id, game.launcher]);

  const [catalogEntry,  setCatalogEntry]  = useState<MediaCatalogEntry | null>(null);

  // Tries both id prefixes — an IGDB game logged as a visual novel is
  // catalogued as "vnovel:<id>", not "game:<id>" (see detect_vn/is_vn), and
  // only one of the two lookups will ever actually resolve. Guessing "game:"
  // alone silently missed every VN, which is exactly what made this panel's
  // own PREQUEL/SEQUEL lookup below come up empty for e.g. Higurashi.
  useEffect(() => {
    if (!gameInfo?.igdb_id) { setCatalogEntry(null); return; }
    const igdbId = gameInfo.igdb_id;
    Promise.all([
      getCatalogEntry(`game:${igdbId}`).catch(() => null),
      getCatalogEntry(`vnovel:${igdbId}`).catch(() => null),
    ]).then(([g, v]) => setCatalogEntry(g ?? v ?? null));
  }, [gameInfo?.igdb_id]);

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
  const relationsExternalId = catalogEntry?.external_id ?? (gameInfo?.igdb_id ? `game:${gameInfo.igdb_id}` : undefined);
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
      const resolveNeighbor = async (rel: NonNullable<typeof prequel>) => {
        if (!viaParent) return { externalId: rel.related_media_external_id, title: rel.title, cover: rel.cover ?? null };
        const neighborRelations = await getMediaRelationsForEditor(rel.related_media_external_id).catch(() => []);
        const editionTypes = ['REMASTER', 'REMAKE'];
        const orderedTypes = selfEditionType ? [selfEditionType, ...editionTypes.filter(t => t !== selfEditionType)] : editionTypes;
        const edition = orderedTypes.map(t => neighborRelations.find(r => r.relation_type === t)).find(Boolean);
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

  const entry      = game.app_id ? coverCache[game.app_id] : undefined;
  const banner     = entry?.banner ?? entry?.cover ?? null;
  const metaDots   = [formatDate(gameInfo?.release_date ?? undefined), gameInfo?.genres?.join(', ')].filter(Boolean).join('  ·  ');

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
          <img src={banner} alt={game.name} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)' }}>
            <IconMonitor />
          </div>
        )}
        <div className="local-game-detail-backdrop" />
        {game.launcher === 'steam' && game.app_id && (
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
          game={game}
          onClose={() => setShowPicker(false)}
          onPicked={() => onMetaRefresh?.()}
        />
      )}

      <div className="local-game-detail-content">
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
          {gameInfo?.developers && gameInfo.developers.length > 0 && (
            <p className="local-game-detail-by">by {gameInfo.developers.join(', ')}</p>
          )}
        </div>

        <div className={`local-media-info-row${(prequelInfo || sequelInfo || bundleChildren.length > 0) ? ' local-media-info-row--has-neighbors' : ''}`}>
          <div className="local-media-left-col">
            <button className="local-game-detail-play" onClick={() => {
              launchGame(game.launcher, game.app_id, game.install_path)
                .then(() => {
                  setHasLaunched(true);
                  const startTime = Math.floor(Date.now() / 1000);
                  const coverUrl = (catalogEntry?.cover_url && catalogEntry.cover_url.startsWith('http'))
                    ? catalogEntry.cover_url
                    : (banner && banner.startsWith('http'))
                    ? banner
                    : undefined;
                  updateDiscordPresence(`Playing ${game.name}`, "", startTime, undefined, coverUrl, game.name, "metadea", "Metadea").catch(() => {});
                })
                .catch(console.error);
            }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Jugar
            </button>

            <div className="local-media-divider-line" />

            <div className="local-game-detail-bottom">
              <div className="local-game-detail-stats">
                <div className="local-game-detail-stat">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>{formatPlaytime(game.playtime_minutes)}</span>
                  <span className="local-game-detail-stat-label">{t.local.stat_time}</span>
                </div>
                <div className="local-game-detail-stat">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span>{formatLastPlayed(game.last_played)}</span>
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

        {metaDots && <p className="local-game-detail-metadots">{metaDots}</p>}
        {gameInfo?.summary && <p className="local-game-detail-summary">{gameInfo.summary}</p>}

        {achievements?.list && achievements.list.length > 0 && (
          <div className="local-game-detail-achievements">
            <p className="local-game-detail-achievements-title">
              Logros — {achievements.unlocked}/{achievements.total}
            </p>
            <div className="local-game-detail-achievement-grid">
              {achievements.list.map((ach: SteamAchievement) => (
                <AchievementCell key={ach.apiname} ach={ach} appId={game.app_id!} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
