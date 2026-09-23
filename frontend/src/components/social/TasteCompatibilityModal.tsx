// Full taste comparison with a visited profile, opened from the heart button
// next to Follow. Everything here comes from the TasteCompatibility the
// profile already computed — no extra IPC; the covers resolve through the
// profile's catalogMap (UserProfileView fetches the missing highlight ids).
//
// Deliberately playful: a hero tinted by both banners and the accent, the
// two avatars linked by a flowing wave with beating hearts (faster and
// brighter the higher the score), a gradient ring + count-up number, a
// verdict line per score band and a confetti burst from 85 %. All motion is
// CSS or one rAF count-up, and all of it stops with reduced motion.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeftRight, CheckCheck, Heart, Layers, Star, type LucideIcon } from 'lucide-react';
import type { CatalogSummary } from '../../lib/tauri';
import { wrapAssetUrl } from '../../lib/tauri';
import {
  tasteByType, tasteComponentBars, tasteVerdict, type TasteCompatibility, type TasteComponentKey, type TasteVerdict,
} from '../../lib/social/taste-compatibility';
import { getGenreLabel } from '../../lib/media/media-types';
import type { TasteRatingPair } from '../../lib/tauri/social-profile';
import { formatUnitRating, unitRatingDiffParts, type RatingSystem } from '../../lib/media/rating-utils';
import { toMediumCover } from '../../lib/media/small-cover';
import { typeLabel } from '../../lib/profile/media-type-label';
import { interpolate } from '../../lib/shared/text/interpolate';
import { getT } from '../../i18n/runtime';
import { ModalShell } from '../shared/ModalShell';
import { genreIcon } from '../shared/genre-icons';
import { TasteRing } from './TasteRing';
import { TasteConfetti } from './TasteConfetti';
import { TasteTimeSplit } from './TasteTimeSplit';
import { useRatingSystem } from './hooks/useRatingSystem';
import { useCountUp } from './hooks/useCountUp';

type S = ReturnType<typeof getT>['social'];
type CatalogMap = Map<string, CatalogSummary>;

// Written by the /profile page (and the navbar reads it too); absent until
// the viewer has opened their own profile once — the initial then stands in.
function readOwnAvatar(): string | null {
  try { return localStorage.getItem('profile_avatar_cache'); } catch { return null; }
}

function readOwnBanner(): string | null {
  try { return localStorage.getItem('profile_banner_cache'); } catch { return null; }
}

function readOwnName(): string {
  try { return localStorage.getItem('profile_username_cache') ?? ''; } catch { return ''; }
}

function Person({ name, label, avatarUrl }: { name: string; label: string; avatarUrl: string | null | undefined }) {
  return (
    <div className="taste-modal-person">
      {avatarUrl
        ? <img className="taste-modal-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" />
        : <div className="taste-modal-avatar taste-modal-avatar--placeholder" aria-hidden="true">{(name[0] ?? '?').toUpperCase()}</div>}
      <span className="taste-modal-person-name">{label}</span>
    </div>
  );
}

function Cover({ id, catalogMap, onNavigate, children }: {
  id: string; catalogMap: CatalogMap; onNavigate: () => void; children?: ReactNode;
}) {
  const entry = catalogMap.get(id);
  const title = entry?.title_main ?? id;
  const cover = toMediumCover(entry?.cover_url);
  return (
    <a className="taste-modal-work" href={`/media?id=${encodeURIComponent(id)}`} title={title} onClick={onNavigate}>
      <span className="taste-cover">
        {cover
          ? <img src={wrapAssetUrl(cover)} alt={title} loading="lazy" />
          : <span className="taste-cover-fallback">{title}</span>}
      </span>
      <span className="taste-modal-work-title">{title}</span>
      {children}
    </a>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="taste-modal-section">
      <div className="profile-section-header">
        <p className="profile-section-label">{label}</p>
        <div className="profile-section-line"></div>
      </div>
      {children}
    </section>
  );
}

function DisagreementCover({ pair, theirName, system, catalogMap, onNavigate, s }: {
  pair: TasteRatingPair; theirName: string; system: RatingSystem; catalogMap: CatalogMap; onNavigate: () => void; s: S;
}) {
  const own = formatUnitRating(pair.own, system);
  const their = formatUnitRating(pair.their, system);
  return (
    <Cover id={pair.external_id} catalogMap={catalogMap} onNavigate={onNavigate}>
      <span className="taste-modal-ratings" aria-label={interpolate(s.taste_disagreement_detail, { own, their })}>
        <span className="taste-modal-rating-who">{s.taste_you}</span>
        <span className="taste-modal-rating-value">{own}</span>
        <span className="taste-modal-rating-who">{theirName}</span>
        <span className="taste-modal-rating-value">{their}</span>
      </span>
    </Cover>
  );
}

const COMPONENT_LABEL: Record<TasteComponentKey, `taste_component_${TasteComponentKey}`> = {
  rating: 'taste_component_rating',
  overlap: 'taste_component_overlap',
  status: 'taste_component_status',
  genre: 'taste_component_genre',
  hours: 'taste_component_hours',
  profile: 'taste_component_profile',
  favorites: 'taste_component_favorites',
};

const VERDICT_KEYS: Record<TasteVerdict, { title: `taste_verdict_${TasteVerdict}`; sub: `taste_verdict_sub_${TasteVerdict}` }> = {
  soulmates: { title: 'taste_verdict_soulmates', sub: 'taste_verdict_sub_soulmates' },
  very: { title: 'taste_verdict_very', sub: 'taste_verdict_sub_very' },
  complementary: { title: 'taste_verdict_complementary', sub: 'taste_verdict_sub_complementary' },
  different: { title: 'taste_verdict_different', sub: 'taste_verdict_sub_different' },
  opposites: { title: 'taste_verdict_opposites', sub: 'taste_verdict_sub_opposites' },
};

/** Score from which the modal opens with a confetti burst. */
const CONFETTI_SCORE = 85;
/** Ring sweep and count-up length, ms (the CSS ring animation matches). */
const COUNT_UP_MS = 1100;

export interface TasteCompatibilityModalProps {
  taste: TasteCompatibility;
  catalogMap: CatalogMap;
  theirName: string;
  theirAvatarUrl: string | null | undefined;
  theirBannerUrl?: string | null;
  s: S;
  onClose: () => void;
}

export function TasteCompatibilityModal({ onClose, ...props }: TasteCompatibilityModalProps) {
  const closeLabel = getT().auth.close;
  return (
    <ModalShell onClose={onClose} label={props.s.taste_label} overlayClassName="taste-modal-overlay" panelClassName="taste-modal-panel">
      <div className="taste-modal-header">
        {/* Section-header style, not an <h3>: several themes underline every
            h2/h3 (`[data-theme] h3 { border-bottom … }`). */}
        <div className="profile-section-header taste-modal-title-row">
          <p className="profile-section-label taste-modal-title">{props.s.taste_label}</p>
          <div className="profile-section-line"></div>
        </div>
        <button type="button" className="taste-modal-close" onClick={onClose} aria-label={closeLabel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <TasteComparison {...props} onNavigate={onClose} />
    </ModalShell>
  );
}

export interface TasteComparisonProps extends Omit<TasteCompatibilityModalProps, 'onClose'> {
  /** Called when a cover link is followed (the modal closes). */
  onNavigate: () => void;
  /** The viewer's avatar/name/banner; read from the /profile page's cache by default. */
  ownAvatarUrl?: string | null;
  ownName?: string;
  ownBannerUrl?: string | null;
}

const HEART_PATH = 'M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.4 3.5 4.3 6.7-1.7 4.7-9.2 9.3-9.2 9.3z';

function HeartGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={HEART_PATH} /></svg>
  );
}

/** Both banners, heavily blurred, behind the hero (one per side). */
function Backdrop({ ownBanner, theirBanner }: { ownBanner: string | null | undefined; theirBanner: string | null | undefined }) {
  return (
    <div className="taste-backdrop" aria-hidden="true">
      {ownBanner && <img className="taste-backdrop-banner taste-backdrop-banner--own" src={ownBanner} alt="" referrerPolicy="no-referrer" />}
      {theirBanner && <img className="taste-backdrop-banner taste-backdrop-banner--their" src={theirBanner} alt="" referrerPolicy="no-referrer" />}
    </div>
  );
}

/** The wave linking both avatars behind the ring, with two beating hearts. */
function Link() {
  return (
    <>
      <svg className="taste-link" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path className="taste-link-path" d="M0 20 Q25 4 50 20 T100 20" vectorEffect="non-scaling-stroke" />
        <path className="taste-link-flow" d="M0 20 Q25 4 50 20 T100 20" vectorEffect="non-scaling-stroke" />
      </svg>
      <HeartGlyph className="taste-link-heart taste-link-heart--own" />
      <HeartGlyph className="taste-link-heart taste-link-heart--their" />
    </>
  );
}

interface StatPill { key: string; icon: LucideIcon; label: string; value: string; suffix?: string }

const pct = (x: number) => Math.round(x * 100);

/** The modal's body — split out so it renders without a portal (tests). */
export function TasteComparison({
  taste, catalogMap, theirName, theirAvatarUrl, theirBannerUrl, s, onNavigate, ownAvatarUrl, ownName, ownBannerUrl,
}: TasteComparisonProps) {
  const system = useRatingSystem();
  const [cachedAvatar] = useState(readOwnAvatar);
  const [cachedName] = useState(readOwnName);
  const [cachedBanner] = useState(readOwnBanner);
  const ownAvatar = ownAvatarUrl === undefined ? cachedAvatar : ownAvatarUrl;
  const ownBanner = ownBannerUrl === undefined ? cachedBanner : ownBannerUrl;
  const ownInitialSource = ownName ?? cachedName;
  const shownScore = useCountUp(taste.score, COUNT_UP_MS);
  const bars = useMemo(() => tasteComponentBars(taste), [taste]);
  const byType = useMemo(() => tasteByType(taste.ratingPairs), [taste]);
  const verdict = VERDICT_KEYS[tasteVerdict(taste.score)];
  const loved = taste.bothLoved;
  const hasHighlights = taste.sharedFavorites.length > 0 || loved.length > 0 || taste.disagreements.length > 0;
  const hasTime = taste.ownTime.length > 0 || taste.theirTime.length > 0;

  const stats: StatPill[] = [
    { key: 'shared', icon: Layers, label: s.taste_stat_shared, value: String(taste.sharedWorks) },
    { key: 'rated', icon: Star, label: s.taste_stat_both_rated, value: String(taste.bothRated) },
    { key: 'completed', icon: CheckCheck, label: s.taste_stat_both_completed, value: String(taste.sharedCompleted) },
    { key: 'diff', icon: ArrowLeftRight, label: s.taste_stat_avg_diff, ...(taste.meanAbsDiff === null ? { value: '—' } : unitRatingDiffParts(taste.meanAbsDiff, system)) },
    { key: 'favs', icon: Heart, label: s.taste_stat_favs, value: String(taste.sharedFavorites.length) },
  ];
  // Drives the link's brightness and heartbeat speed (see CSS).
  const heroStyle = { '--taste-intensity': taste.score / 100 } as CSSProperties;

  return (
    <>
      <div className="taste-modal-hero" style={heroStyle}>
        <Backdrop ownBanner={ownBanner} theirBanner={theirBannerUrl} />
        <div className="taste-hero-row">
          <Link />
          <Person name={ownInitialSource || s.taste_you} label={s.taste_you} avatarUrl={ownAvatar} />
          <div className="taste-modal-score" role="img" aria-label={interpolate(s.taste_score_aria, { n: taste.score })}>
            <TasteRing score={taste.score} className="taste-modal-ring" />
            <span className="taste-modal-score-value">{`${shownScore}%`}</span>
            {taste.score >= CONFETTI_SCORE && <TasteConfetti />}
          </div>
          <Person name={theirName} label={theirName} avatarUrl={theirAvatarUrl} />
        </div>
        <p className="taste-verdict">{s[verdict.title]}</p>
        <p className="taste-verdict-sub">{s[verdict.sub]}</p>
        <p className="taste-modal-hint">{interpolate(s.taste_based_on, { n: taste.sharedWorks })}</p>
      </div>

      <ul className="taste-modal-stats">
        {stats.map(({ key, icon: Icon, label, value, suffix }) => (
          <li className={`taste-modal-stat taste-modal-stat--${key}`} key={key}>
            <span className="taste-modal-stat-head">
              <Icon className="taste-modal-stat-icon" size={14} strokeWidth={2.25} aria-hidden="true" />
              <span className="taste-modal-stat-value">
                {value}
                {suffix && <span className="taste-modal-stat-suffix">{suffix}</span>}
              </span>
            </span>
            <span className="taste-modal-stat-label">{label}</span>
          </li>
        ))}
      </ul>

      {taste.sharedGenres.length > 0 && (
        <Section label={s.taste_genres_title}>
          <ul className="taste-genres">
            {taste.sharedGenres.map((g, i) => {
              const GenreIcon = genreIcon(g.genre);
              const label = getGenreLabel(g.genre);
              const detail = interpolate(s.taste_genre_detail, { own: pct(g.own), their: pct(g.their) });
              return (
                <li key={g.genre} className={`taste-genre${i < 3 ? ' taste-genre--top' : ''}`} title={`${label} · ${detail}`}>
                  <GenreIcon className="taste-genre-icon" size={13} strokeWidth={2.25} aria-hidden="true" />
                  <span className="taste-genre-label">{label}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {hasTime && (
        <Section label={s.taste_time_title}>
          <TasteTimeSplit ownTime={taste.ownTime} theirTime={taste.theirTime} theirName={theirName} s={s} />
        </Section>
      )}

      <Section label={s.taste_breakdown}>
        <div className="taste-modal-bars">
          {bars.map((bar, i) => (
            <div className="taste-modal-bar" key={bar.key}>
              <span className="taste-modal-bar-label">{s[COMPONENT_LABEL[bar.key]]}</span>
              <span className="taste-modal-bar-track" aria-hidden="true">
                <span className="taste-modal-bar-fill" style={{ width: `${pct(bar.fraction)}%`, animationDelay: `${i * 70}ms` }} />
              </span>
              <span className="taste-modal-bar-value">
                {bar.maxPoints > 0 ? interpolate(s.taste_points, { n: bar.points, max: bar.maxPoints }) : '—'}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {byType.length > 1 && (
        <Section label={s.taste_by_type}>
          <div className="taste-modal-bars">
            {byType.map((t, i) => (
              <div className="taste-modal-bar" key={t.type}>
                <span className="taste-modal-bar-label">{typeLabel(t.type)}</span>
                <span className="taste-modal-bar-track" aria-hidden="true">
                  <span className="taste-modal-bar-fill" style={{ width: `${t.agreement}%`, animationDelay: `${i * 70}ms` }} />
                </span>
                <span className="taste-modal-bar-value">{interpolate(s.taste_type_detail, { pct: t.agreement, n: t.bothRated })}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {taste.sharedFavorites.length > 0 && (
        <Section label={s.taste_shared_favs}>
          <div className="taste-covers">
            {taste.sharedFavorites.map(id => <Cover key={id} id={id} catalogMap={catalogMap} onNavigate={onNavigate} />)}
          </div>
        </Section>
      )}
      {loved.length > 0 && (
        <Section label={s.taste_both_loved}>
          <div className="taste-covers">
            {loved.map(p => <Cover key={p.external_id} id={p.external_id} catalogMap={catalogMap} onNavigate={onNavigate} />)}
          </div>
        </Section>
      )}
      {taste.disagreements.length > 0 && (
        <Section label={s.taste_disagreements}>
          <div className="taste-covers">
            {taste.disagreements.map(p => (
              <DisagreementCover
                key={p.external_id} pair={p} theirName={theirName} system={system}
                catalogMap={catalogMap} onNavigate={onNavigate} s={s}
              />
            ))}
          </div>
        </Section>
      )}
      {!hasHighlights && <p className="taste-modal-hint">{s.taste_nothing_yet}</p>}
    </>
  );
}
