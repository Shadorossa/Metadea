import { useEffect, useState } from 'react';
import { getActiveRatingSystem, syncActiveRatingSystem, type RatingSystem } from '../../../lib/media/rating-utils';

/** The viewer's rating system: the cached one right away, then the synced one. */
export function useRatingSystem(): RatingSystem {
  const [system, setSystem] = useState<RatingSystem>(getActiveRatingSystem);
  useEffect(() => { syncActiveRatingSystem().then(setSystem).catch(() => {}); }, []);
  return system;
}
