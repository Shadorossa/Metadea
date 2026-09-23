import { useEffect, useRef } from 'react';
import type { FriendScore } from '../../../lib/anilist/friends';

export function useFriendsGridCutoff(friendsScores: FriendScore[]) {
  const usersScrollRef = useRef<HTMLDivElement | null>(null);
  const usersGridRef = useRef<HTMLDivElement | null>(null);

  // Caps the Usuarios grid to exactly 3 rows — computed purely from the
  // grid's own box width via ResizeObserver, never by measuring/counting
  // child cards. Every previous version of this effect keyed off the card
  // count (via the friendsScores dependency, then a MutationObserver on the
  // grid's children) and kept breaking the same way: whenever
  // fetchFollowedFriendsScores resolves fast enough (its own 10-minute
  // cache, or just a quick network response), the "how many cards are
  // there" signal and "did the effect actually re-measure yet" signal could
  // race, silently leaving max-height unset and showing the whole list
  // uncapped. A ResizeObserver on the container has nothing to race — it
  // fires once synchronously on observe() and then only on genuine width
  // changes, regardless of how or when the cards inside it change.
  useEffect(() => {
    const scrollEl = usersScrollRef.current;
    const gridEl = usersGridRef.current;
    if (!scrollEl || !gridEl) return;

    const PER_ROW = 5; // matches .media-users-grid's grid-template-columns
    const ROWS_VISIBLE = 3;

    const updateFade = () => {
      const atTop = scrollEl.scrollTop <= 0;
      const atBottom = scrollEl.scrollTop >= scrollEl.scrollHeight - scrollEl.clientHeight - 1;
      scrollEl.classList.toggle('at-top', atTop);
      scrollEl.classList.toggle('at-bottom', atBottom);
    };

    const recompute = () => {
      const cutoffIndex = ROWS_VISIBLE * PER_ROW;
      if (gridEl.children.length <= cutoffIndex) {
        scrollEl.style.maxHeight = '';
        updateFade();
        return;
      }
      const style = getComputedStyle(gridEl);
      const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
      const paddingTop = parseFloat(style.paddingTop || '0') || 0;
      // Cards are square (aspect-ratio 1/1 on .media-user-avatar, and the
      // card itself is just that avatar plus a name/score line below it of
      // roughly fixed height) — cardWidth from the grid's own box width is
      // all that's needed, no child measurement required.
      const cardWidth = (gridEl.clientWidth - gap * (PER_ROW - 1)) / PER_ROW;
      const nameLineHeight = 40; // height of the star-rating line under each avatar
      const rowHeight = cardWidth + nameLineHeight;
      scrollEl.style.maxHeight = `${paddingTop + ROWS_VISIBLE * rowHeight + (ROWS_VISIBLE - 1) * gap}px`;
      updateFade();
    };

    recompute();
    scrollEl.addEventListener('scroll', updateFade);

    // ResizeObserver watches the grid's whole content-box, not just its
    // width — adding/removing cards changes its height too (more rows), so
    // this alone already re-fires recompute() on a card-count change; no
    // separate MutationObserver needed to catch that case.
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(gridEl);

    return () => {
      scrollEl.removeEventListener('scroll', updateFade);
      resizeObserver.disconnect();
    };
  }, [friendsScores]);

  return { usersScrollRef, usersGridRef };
}
