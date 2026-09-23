import type { RefObject } from 'react';
import type { Translations } from '../../../i18n/index';
import type { FriendScore } from '../../../lib/anilist/friends';
import type { RatingSystem } from '../../../lib/media/rating-utils';
import { UserScoreCard } from './MediaPageCards';

interface Props {
  t: Translations['media'];
  friendsScores: FriendScore[];
  friendsLoading: boolean;
  ratingSystem: RatingSystem;
  // Owned by the page: the 3-row cutoff effect keyed on friendsScores reads
  // them there, and keeps its original timing (refs may still be null).
  scrollRef: RefObject<HTMLDivElement | null>;
  gridRef: RefObject<HTMLDivElement | null>;
}

export function MediaScoresSection({ t: tm, friendsScores, friendsLoading, ratingSystem, scrollRef, gridRef }: Props) {
  return (
            <div className="media-users-section">
              <div className="media-section-header-row">
                <p className="section-label">{tm.section_users}</p>
                <div className="media-section-header-line" />
              </div>
              <div className="media-users-grid-scroll" ref={scrollRef}>
                <div className="media-users-grid" ref={gridRef}>
                  {friendsLoading && friendsScores.length === 0
                    // 5 per row × 3 rows — matches PER_ROW/ROWS_VISIBLE in the
                    // fade/cutoff effect above, so the skeleton fills exactly
                    // the same 3 rows the real grid caps itself to (instead of
                    // a half-filled row that looked broken).
                    ? Array.from({ length: 15 }).map((_, i) => (
                        <div key={i} className="media-user-card media-user-card--skeleton" />
                      ))
                    : friendsScores.map((f, i) => (
                    <UserScoreCard key={i} score={f} ratingSystem={ratingSystem} />
                  ))}
                </div>
              </div>
            </div>
  );
}
