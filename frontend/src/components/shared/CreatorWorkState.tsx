import type { Translations } from '../../i18n/index';
import type { WorkLibraryState } from '../../lib/media/creator-completion';

// Card treatment for a creator's work (company page grid, author page
// grid): completed → accent border + ✓ tag, in progress → thin progress
// bar, planned → subtle tag, missing → slightly dimmed, dropped → as is.
// Styles: styles/pages/creator-works.css.
export function creatorWorkClass(state: WorkLibraryState | null): string {
  return state ? ` creator-work creator-work--${state.replace('_', '-')}` : '';
}

interface Props {
  state: WorkLibraryState | null;
  /** 0–1 for an in-progress work with a known length. */
  progress: number | null;
  strings: Translations['creator_completion'];
}

export function CreatorWorkState({ state, progress, strings }: Props) {
  if (state === 'completed') {
    return <span className="creator-work-tag creator-work-tag--completed" title={strings.state_completed} aria-label={strings.state_completed}>✓</span>;
  }
  if (state === 'planned') {
    return <span className="creator-work-tag creator-work-tag--planned">{strings.state_planned}</span>;
  }
  if (state === 'in_progress') {
    return (
      <span
        className={`creator-work-progress${progress == null ? ' creator-work-progress--unknown' : ''}`}
        role="progressbar"
        aria-label={strings.state_in_progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress == null ? undefined : Math.round(progress * 100)}
      >
        <span className="creator-work-progress-fill" style={{ width: `${Math.round((progress ?? 1) * 100)}%` }} />
      </span>
    );
  }
  return null;
}
