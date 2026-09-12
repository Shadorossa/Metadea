import { isInProgressStatus } from '../../../lib/constants/media';

export interface StatusBadgeInfo { label: string; modifier: string }

// Maps a library status to the badge shown on a game card — same status
// vocabulary LocalMediaCard already uses for catalog "Pendiente" entries
// (see local.css's .local-media-status-badge--* modifiers), extended here
// to installed games (GameCard) so a completed/paused/dropped/planning
// install reads the same regardless of whether it's sitting in its own
// status section or mixed into a launcher (Steam/Nintendo/...) section.
export function getStatusBadge(status: string | null | undefined): StatusBadgeInfo | null {
  if (!status) return null;
  if (status === 'planning') return { label: 'Pendiente', modifier: 'planning' };
  if (status === 'completed') return { label: 'Completado', modifier: 'completed' };
  if (status === 'paused') return { label: 'Pausado', modifier: 'paused' };
  if (status === 'dropped') return { label: 'Abandonado', modifier: 'dropped' };
  if (isInProgressStatus(status)) return { label: 'En progreso', modifier: 'progress' };
  return null;
}
