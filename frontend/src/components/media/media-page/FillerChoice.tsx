import type { Translations } from '../../../i18n/index';
import { effectiveEpisodeTotal, type FillerInfo } from '../../../lib/anime/filler';
import { interpolate } from '../../../lib/shared/text/interpolate';

interface Props {
  t: Translations['media']['filler'];
  skip: boolean;
  onChange: (skip: boolean) => void;
  info: FillerInfo | undefined;
  total: number | null | undefined;
  disabled?: boolean;
}

// "Filler: Watched / Skipped" for a library entry of an anime with filler
// (media page episodes toolbar and the library editor). Skipped shows the
// effective total, e.g. "203 eps (366 with filler)".
export function FillerChoice({ t, skip, onChange, info, total, disabled }: Props) {
  const effective = skip ? effectiveEpisodeTotal({ skip_filler: 1 }, info, total) : null;
  return (
    <div className="media-filler-choice" role="group" aria-label={t.choice_label}>
      <span className="media-filler-choice-label">{t.choice_label}</span>
      <div className="media-filler-choice-buttons">
        <button
          type="button"
          className={`media-filler-choice-btn${skip ? '' : ' is-active'}`}
          aria-pressed={!skip}
          disabled={disabled}
          onClick={() => { if (skip) onChange(false); }}
        >
          {t.choice_watched}
        </button>
        <button
          type="button"
          className={`media-filler-choice-btn${skip ? ' is-active' : ''}`}
          aria-pressed={skip}
          title={t.choice_hint}
          disabled={disabled}
          onClick={() => { if (!skip) onChange(true); }}
        >
          {t.choice_skipped}
        </button>
      </div>
      {skip && effective != null && total != null && total > 0 && (
        <span className="media-filler-choice-total">{interpolate(t.effective_total, { canon: effective, total })}</span>
      )}
    </div>
  );
}
