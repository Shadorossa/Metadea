import type { Dispatch, SetStateAction } from 'react';
import type { Translations } from '../../../i18n/index';
import { getT } from '../../../i18n/runtime';
import type { FavoriteCustomImage } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import { Pagination } from '../Pagination';
import { CharacterCard } from './MediaPageCards';
import { SectionTabs } from './MediaPageControls';
import type { MediaSpoilers } from './useMediaSpoilers';
import { SakugaMediaTab } from '../../sakuga/SakugaMediaTab';
import { useCachedSakugaArtists, useSakugaSeries } from '../../sakuga/hooks/useSakugaSeries';

export type CharTab = 'characters' | 'staff' | 'sakuga';

const CHARACTER_PAGE_SIZE = 12;

interface Props {
  data: MediaPageData;
  t: Translations['media'];
  charTab: CharTab;
  setCharTab: Dispatch<SetStateAction<CharTab>>;
  characterPage: number;
  setCharacterPage: Dispatch<SetStateAction<number>>;
  customImagesMap: Map<string, FavoriteCustomImage>;
  showUsers: boolean;
  /** Spoiler shield answers for this page (absent: nothing hidden). */
  spoilers?: MediaSpoilers;
}

export function MediaCastSection({
  data,
  t: tm,
  charTab,
  setCharTab,
  characterPage,
  setCharacterPage,
  customImagesMap,
  showUsers,
  spoilers,
}: Props) {
  const roleOrder = (role?: string) => {
    const normalizedRole = role?.toLowerCase().trim() || '';
    if (normalizedRole === 'main') return 0;
    if (normalizedRole === 'supporting') return 1;
    if (normalizedRole === 'background') return 2;
    return 3; // Unknown roles go last
  };

  const sortCharactersByRole = (chars: typeof data.characters) => {
    return [...chars].sort((a, b) => roleOrder(a.role) - roleOrder(b.role));
  };

  const hasStaff = !!(data.staff && data.staff.length > 0);
  // Sakuga (anime only): shown when the series has a Sakugabooru tag with
  // posts; the staff tab badges animators whose tag is already cached.
  const sakugaSeries = useSakugaSeries(data);
  const showSakuga = !!sakugaSeries;
  const activeTab: CharTab = charTab === 'sakuga' && !showSakuga ? 'characters' : charTab;
  const staffIds = (data.staff ?? []).map(member => member.id ?? '').filter(Boolean);
  const sakugaArtists = useCachedSakugaArtists(staffIds, data.type === 'anime' && activeTab === 'staff');
  const ts = getT().sakuga;
  const activeCharList = sortCharactersByRole(activeTab === 'staff' ? (data.staff ?? []) : data.characters);
  const tabs = [
    { key: 'characters', label: tm.section_characters, active: activeTab === 'characters', onClick: () => { setCharTab('characters'); setCharacterPage(1); } },
    ...(hasStaff ? [{ key: 'staff', label: tm.section_staff, active: activeTab === 'staff', onClick: () => { setCharTab('staff'); setCharacterPage(1); } }] : []),
    ...(showSakuga ? [{ key: 'sakuga', label: ts.tab, active: activeTab === 'sakuga', onClick: () => { setCharTab('sakuga'); setCharacterPage(1); } }] : []),
  ];

  return (
            <div className={`media-chars-section${!showUsers ? ' media-chars-section--full' : ''}`}>
              <div className="media-section-header-row">
                {/* Staff (director, writer, composer, ...) rides the same
                    grid as Personajes, switched via a tab — same pattern as
                    Related/Editions/Recommended above. Only shown when the
                    provider actually returned staff data (AniList/TMDB). */}
                <SectionTabs
                  fallbackLabel={tm.section_characters}
                  tabs={tabs.length > 1 ? tabs : []}
                />
              </div>
              {activeTab === 'sakuga' && sakugaSeries ? (
                <SakugaMediaTab seriesTag={sakugaSeries} staff={data.staff ?? []} t={ts} />
              ) : (
              <>
              <div className="media-chars-grid">
                {activeCharList
                  .slice((characterPage - 1) * CHARACTER_PAGE_SIZE, characterPage * CHARACTER_PAGE_SIZE)
                  .map((c, i) => (
                    <CharacterCard
                      key={i}
                      character={c}
                      charTab={activeTab === 'staff' ? 'staff' : 'characters'}
                      customImagesMap={customImagesMap}
                      badge={activeTab === 'staff' && c.id && sakugaArtists[c.id]
                        ? <span className="sakuga-badge" title={ts.badge_title}>▶ {ts.badge}</span>
                        : undefined}
                      onRevealSpoiler={activeTab === 'characters' && spoilers?.isCastMemberHidden(c.id)
                        ? () => spoilers.revealCastMember(c.id ?? '')
                        : undefined}
                    />
                  ))}
              </div>
              {activeCharList.length > CHARACTER_PAGE_SIZE && (
                <Pagination
                  currentPage={characterPage}
                  totalPages={Math.ceil(activeCharList.length / CHARACTER_PAGE_SIZE)}
                  onChange={setCharacterPage}
                />
              )}
              </>
              )}
            </div>
  );
}
