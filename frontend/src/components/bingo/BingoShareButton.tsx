// "Share image" for a Yearly Bingo board (modal, own profile tab, another
// user's tab): the shared ShareImageButton fed from the board on screen.
// Scores use the viewer's rating system; the owner block is the signed-in
// user unless another user's name/avatar is passed.
import { useCallback } from 'react';
import type { BingoCell } from '../../lib/tauri/yearly-bingo';
import type { BingoResult } from '../../lib/bingo/bingo-result';
import { bingoHasPicks, bingoShareData } from '../../lib/bingo/bingo-share';
import { averageScoreSuffix, formatAverageScore, type RatingSystem } from '../../lib/media/rating-utils';
import { bingoImageFileName, readShareOwner, type ShareImageInput, type ShareOwner } from '../../lib/share-image';
import { ShareImageButton } from '../shared/ShareImageButton';

interface Props {
  year: number;
  cells: readonly BingoCell[];
  /** null = the picks variant (before the result phase). */
  result: BingoResult | null;
  ratingSystem: RatingSystem;
  /** Another user's board; the signed-in user when omitted. */
  owner?: ShareOwner;
}

export function BingoShareButton({ year, cells, result, ratingSystem, owner }: Props) {
  const build = useCallback(async (): Promise<ShareImageInput> => ({
    kind: 'bingo',
    owner: owner ?? readShareOwner(),
    data: bingoShareData(year, cells, result, rating => formatAverageScore(rating, ratingSystem) + averageScoreSuffix(ratingSystem)),
  }), [year, cells, result, ratingSystem, owner]);

  return (
    <ShareImageButton
      build={build}
      fileName={bingoImageFileName(year)}
      className="bingo-share"
      disabled={!bingoHasPicks(cells)}
    />
  );
}
