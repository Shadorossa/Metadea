import { useState, memo } from 'react';
import type { SearchResult } from '../../lib/search/index';
import { prefetchMediaData } from '../../lib/media/media-page-data';
import { DETAIL_SUPPORTED_TYPES } from '../../lib/media/media-types';
import { formatAverageScore, getActiveRatingSystem } from '../../lib/media/rating-utils';
import { toSmallCover } from '../../lib/media/small-cover';
import { CoverImage } from '../shared/CoverImage';

export const SearchResultCard = memo(function SearchResultCard({ result }: { result: SearchResult }) {
  const hasDetail = (DETAIL_SUPPORTED_TYPES as readonly string[]).includes(result.type);
  const [isLandscape, setIsLandscape] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  function handleCoverLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    // Key art standing in for the cover is landscape on purpose (cropped by CSS).
    if (img.dataset.textless) return;
    if (img.naturalWidth > img.naturalHeight) setIsLandscape(true);
  }

  function handleMouseEnter() {
    if (hasDetail && result.type !== 'character' && result.type !== 'staff') prefetchMediaData(result.externalId);
  }

  async function handleClick() {
    if (hasDetail) {
      const { navigate } = await import('astro:transitions/client');
      if (result.type === 'character') {
        const rawId = result.externalId.replace('character:', '');
        navigate(`/character?id=${rawId}`);
        return;
      }
      if (result.type === 'staff') {
        navigate(`/author?id=${result.externalId}`);
        return;
      }
      if (result.authorNames?.length) {
        sessionStorage.setItem(`book_authors:${result.externalId}`, JSON.stringify(result.authorNames));
      }
      navigate(`/media?id=${result.externalId}`);
    }
  }

  return (
    <div
      className={`group flex flex-col card-cursor${hasDetail ? ' card-clickable' : ''}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      role={hasDetail ? 'button' : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      onKeyDown={hasDetail ? (e) => e.key === 'Enter' && handleClick() : undefined}
    >
      <div className="card-media-base mb-1.5">
        {result.coverUrl && !loadFailed && !isLandscape ? (
          <CoverImage
            externalId={result.externalId}
            src={toSmallCover(result.coverUrl)}
            alt={result.titleMain}
            className="card-media-img"
            loading="lazy"
            decoding="async"
            onLoad={handleCoverLoad}
            onError={() => setLoadFailed(true)}
          />
        ) : (
          <div className="card-media-placeholder" />
        )}
        {result.scoreGlobal !== null && (
          <div className="card-rating-badge">{formatAverageScore(result.scoreGlobal, getActiveRatingSystem())}</div>
        )}
      </div>
      <p className="card-title">{result.titleMain}</p>
      {result.releaseYear && (
        <p className="card-year">{result.releaseYear}</p>
      )}
    </div>
  );
});
