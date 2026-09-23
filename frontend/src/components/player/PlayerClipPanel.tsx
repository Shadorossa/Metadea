import { Scissors } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import { clipLength } from '../../lib/player/clip-range';
import { formatClock } from '../../lib/player/format-time';
import type { ClipMode } from './hooks/useClipMode';

interface Props {
  clip: ClipMode;
  t: Translations['player'];
  hasSubtitles: boolean;
}

// Clip mode popover above the scissors button, in two steps: while trimming
// it shows the selection (handles live on the seek bar) and Done; once the
// trim is confirmed it becomes the chooser — format, size, audio, burned
// subtitles — and Export. The chooser starts from the last answer
// (lib/player/clip-choice.ts).
export function PlayerClipPanel({ clip, t, hasSubtitles }: Props) {
  const { options, setOptions, range, phase } = clip;
  const gif = options.format === 'gif';
  const length = clipLength(range).toFixed(1);

  return (
    <div className="player-menu player-clip-panel" role="dialog" aria-label={t.clip_title}>
      <div className="player-clip-panel__header">
        <Scissors size={16} aria-hidden="true" />
        <strong>{phase === 'choosing' ? t.clip_choose_title : t.clip_title}</strong>
        <span className="player-clip-panel__range">
          {formatClock(range.start)} – {formatClock(range.end)} · {t.clip_length.replace('{seconds}', length)}
        </span>
      </div>

      {phase === 'trimming' && (
        <>
          <p className="player-clip-panel__hint">{t.clip_keys_hint}</p>
          <div className="player-clip-panel__actions">
            <button type="button" className="player-toast__action" onClick={clip.cancel}>{t.clip_cancel}</button>
            <button type="button" className="player-clip-panel__export" onClick={clip.confirmTrim}>{t.clip_done}</button>
          </div>
        </>
      )}

      {phase === 'choosing' && (
        <>
          <fieldset className="player-clip-panel__group">
            <legend>{t.clip_format}</legend>
            {(['gif', 'mp4'] as const).map(format => (
              <label key={format} className="player-clip-panel__choice">
                <input type="radio" name="player-clip-panel-format" checked={options.format === format} onChange={() => setOptions({ ...options, format })} />
                <span>{format === 'mp4' ? t.clip_format_mp4 : t.clip_format_gif}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="player-clip-panel__group" disabled={gif}>
            <legend>{t.clip_size}</legend>
            {(['480p', '720p'] as const).map(size => (
              <label key={size} className="player-clip-panel__choice">
                <input type="radio" name="player-clip-panel-size" checked={options.size === size} onChange={() => setOptions({ ...options, size })} />
                <span>{size === '480p' ? t.clip_size_480 : t.clip_size_720}</span>
              </label>
            ))}
          </fieldset>

          <div className="player-clip-panel__toggles">
            <label className="player-clip-panel__choice">
              <input
                type="checkbox"
                checked={!gif && options.includeAudio}
                disabled={gif}
                onChange={event => setOptions({ ...options, includeAudio: event.currentTarget.checked })}
              />
              <span>{t.clip_include_audio}</span>
            </label>
            <label className="player-clip-panel__choice">
              <input
                type="checkbox"
                checked={hasSubtitles && options.burnSubtitles}
                disabled={!hasSubtitles}
                onChange={event => setOptions({ ...options, burnSubtitles: event.currentTarget.checked })}
              />
              <span>{t.clip_burn_subtitles}</span>
            </label>
          </div>

          <div className="player-clip-panel__actions">
            <button type="button" className="player-toast__action" onClick={clip.backToTrim}>{t.clip_back}</button>
            <button type="button" className="player-clip-panel__export" onClick={clip.exportClip}>{t.clip_export}</button>
          </div>
        </>
      )}
    </div>
  );
}
