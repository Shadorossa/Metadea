// Unified formatters export barrel consolidating scattered formatter imports
// from formatDate.ts, formatters.ts (local/utils), and rating-utils.ts.
// Allows "import { formatPlaytime, formatDateLong } from '...formatters-barrel'"
// instead of importing from 3+ different modules.

// From lib/shared/formatDate.ts
export {
  formatDateShort,
  formatDateLong,
  formatDateNumeric,
  formatUnixTimestampShort,
  formatLocalDateLong,
  getLocaleCode,
} from './formatDate';

// From components/local/utils/formatters.ts
export {
  formatPlaytime,
  formatLastPlayed,
  formatUnixDateLong,
  formatWatchedAt,
  formatPlaybackTime,
  formatBytes,
} from '../../components/local/utils/formatters';

// From lib/media/rating-utils.ts
export {
  formatAverageScore,
  averageScoreSuffix,
  formatRatingHtml,
  ratingToEmoji,
  dbRatingToStars5,
} from '../media/rating-utils';

// From lib/media/mapper-utils.ts (date/score formatting)
export {
  formatDateParts,
  normalizeScore100,
} from '../media/mapper-utils';
