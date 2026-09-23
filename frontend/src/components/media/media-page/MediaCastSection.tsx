import type { Dispatch, SetStateAction } from 'react';
import type { Translations } from '../../../i18n/index';
import type { FavoriteCustomImage } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import { Pagination } from '../Pagination';
import { CharacterCard } from './MediaPageCards';
import { SectionTabs } from './MediaPageControls';

export type CharTab = 'characters' | 'staff';

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
  const activeCharList = sortCharactersByRole(charTab === 'staff' ? (data.staff ?? []) : data.characters);

  return (
            <div className={`media-chars-section${!showUsers ? ' media-chars-section--full' : ''}`}>
              <div className="media-section-header-row">
                {/* Staff (director, writer, composer, ...) rides the same
                    grid as Personajes, switched via a tab — same pattern as
                    Related/Editions/Recommended above. Only shown when the
                    provider actually returned staff data (AniList/TMDB). */}
                <SectionTabs
                  fallbackLabel={tm.section_characters}
                  tabs={hasStaff ? [
                    { key: 'characters', label: tm.section_characters, active: charTab === 'characters', onClick: () => { setCharTab('characters'); setCharacterPage(1); } },
                    { key: 'staff', label: tm.section_staff, active: charTab === 'staff', onClick: () => { setCharTab('staff'); setCharacterPage(1); } },
                  ] : []}
                />
              </div>
              <div className="media-chars-grid">
                {activeCharList
                  .slice((characterPage - 1) * CHARACTER_PAGE_SIZE, characterPage * CHARACTER_PAGE_SIZE)
                  .map((c, i) => (
                    <CharacterCard key={i} character={c} charTab={charTab} customImagesMap={customImagesMap} />
                  ))}
              </div>
              {activeCharList.length > CHARACTER_PAGE_SIZE && (
                <Pagination
                  currentPage={characterPage}
                  totalPages={Math.ceil(activeCharList.length / CHARACTER_PAGE_SIZE)}
                  onChange={setCharacterPage}
                />
              )}
            </div>
  );
}
