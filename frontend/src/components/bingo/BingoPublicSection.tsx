// Another user's "Bingo" tab (components/social/UserProfileView): their
// synced boards, newest year first, read-only — the same board and result
// line their own profile tab shows. The result (completed cells, scores) is
// the owner's, synced from their app; nothing here reads the viewer's
// library. The share image carries the owner's name and avatar and the
// viewer's rating system, like the scores on screen.
import { getT } from '../../i18n/runtime';
import { BINGO_RESULTS_DAY } from '../../lib/bingo/bingo-calendar';
import type { PublicBingoBoard } from '../../lib/social/public-profile-mapping';
import type { RatingSystem } from '../../lib/media/rating-utils';
import type { ShareOwner } from '../../lib/share-image';
import { formatDateLong } from '../../lib/shared/text/format-date';
import { interpolate } from '../../lib/shared/text/interpolate';
import { BingoBoard } from './BingoBoard';
import { BingoSummary } from './BingoSummary';
import { BingoShareButton } from './BingoShareButton';

interface Props {
  boards: readonly PublicBingoBoard[];
  ratingSystem: RatingSystem;
  /** The profile's owner, drawn in the share image header. */
  owner: ShareOwner;
}

export function BingoPublicSection({ boards, ratingSystem, owner }: Props) {
  const b = getT().bingo;
  return (
    <div className="bingo-layout">
      {boards.map(({ year, cells, result }) => (
        <section key={year} className="bingo-public-board">
          <header className="bingo-modal-header">
            <div>
              <h2 className="bingo-layout-title">{interpolate(b.title, { year })}</h2>
              <p className="bingo-modal-subtitle">
                {result ? b.results_heading : interpolate(b.results_from, { date: formatDateLong(new Date(year, 11, BINGO_RESULTS_DAY)) })}
              </p>
            </div>
            <div className="bingo-header-actions">
              <BingoShareButton year={year} cells={cells} result={result} ratingSystem={ratingSystem} owner={owner} />
              <span className="bingo-count">{interpolate(b.filled_count, { count: cells.filter(Boolean).length, total: cells.length })}</span>
            </div>
          </header>
          {result && <BingoSummary result={result} />}
          <BingoBoard
            slots={cells.map((item, i) => ({ key: item?.external_id ?? `empty-${i}`, item }))}
            editable={false}
            result={result}
            ratingSystem={ratingSystem}
          />
        </section>
      ))}
    </div>
  );
}
