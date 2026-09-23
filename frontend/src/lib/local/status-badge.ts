import { isInProgressStatus } from '../media/media-types';
import type { Translations } from '../../i18n/index';

// labelKey indexes Translations['profile'], so the caller renders it in the
// active locale (this module stays free of any runtime i18n lookup).
export interface StatusBadgeInfo {
  labelKey: keyof Pick<Translations['profile'], 'status_planning' | 'status_completed' | 'status_paused' | 'status_dropped' | 'section_in_progress'>;
  modifier: string;
}

// Maps a library status to the badge shown on a game card — same status
// vocabulary LocalMediaCard already uses for catalog "Pendiente" entries
// (see local.css's .local-media-status-badge--* modifiers), extended here
// to installed games (GameCard) so a completed/paused/dropped/planning
// install reads the same regardless of whether it's sitting in its own
// status section or mixed into a launcher (Steam/Nintendo/...) section.
export function getStatusBadge(status: string | null | undefined): StatusBadgeInfo | null {
  if (!status) return null;
  if (status === 'planning') return { labelKey: 'status_planning', modifier: 'planning' };
  if (status === 'completed') return { labelKey: 'status_completed', modifier: 'completed' };
  if (status === 'paused') return { labelKey: 'status_paused', modifier: 'paused' };
  if (status === 'dropped') return { labelKey: 'status_dropped', modifier: 'dropped' };
  if (isInProgressStatus(status)) return { labelKey: 'section_in_progress', modifier: 'progress' };
  return null;
}
