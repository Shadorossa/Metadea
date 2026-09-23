import { THUMB_SIZES, type TierSettings } from '../../lib/tier/tier-settings';
import type { ShareImageInput } from '../../lib/share-image';
import type { Translations } from '../../i18n/types';
import { ShareImageButton } from '../shared/ShareImageButton';
import type { TierSaveStatus } from './hooks/useTierEditor';

// The editor's action strip: add items, undo/redo, display settings,
// profile visibility, the share image (components/shared/ShareImageButton)
// and the autosave status.

interface Props {
  t: Translations['tier'];
  canUndo: boolean;
  canRedo: boolean;
  settings: TierSettings;
  isPublic: boolean;
  /** Share image label (share_image.button_label). */
  shareLabel: string;
  shareFileName: string;
  buildShareImage: () => Promise<ShareImageInput>;
  saveStatus: TierSaveStatus;
  saveError: string | null;
  hasRanked: boolean;
  onAddItems: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSettings: (patch: Partial<TierSettings>) => void;
  onPublic: (value: boolean) => void;
  onReset: () => void;
  onRetrySave: () => void;
}

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export function TierToolbar(props: Props) {
  const { t, settings, saveStatus } = props;
  const sizeLabels = { small: t.thumb_small, medium: t.thumb_medium, large: t.thumb_large };
  const sizeIndex = THUMB_SIZES.indexOf(settings.thumbSize);

  return (
    <div className="tier-toolbar" role="toolbar" aria-label={t.title}>
      <button type="button" className="tier-btn tier-btn--primary" onClick={props.onAddItems}>
        <Icon d="M12 5v14M5 12h14" /> {t.add_items}
      </button>
      <div className="tier-toolbar-group">
        <button type="button" className="tier-icon-btn" aria-label={t.undo} title={t.undo} disabled={!props.canUndo} onClick={props.onUndo}>
          <Icon d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
        </button>
        <button type="button" className="tier-icon-btn" aria-label={t.redo} title={t.redo} disabled={!props.canRedo} onClick={props.onRedo}>
          <Icon d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
        </button>
      </div>

      <label className="tier-size-slider">
        <span>{t.thumb_size}</span>
        <input
          type="range"
          min={0}
          max={THUMB_SIZES.length - 1}
          step={1}
          value={sizeIndex}
          aria-valuetext={sizeLabels[settings.thumbSize]}
          onChange={e => props.onSettings({ thumbSize: THUMB_SIZES[Number(e.target.value)] })}
        />
        <span className="tier-size-value">{sizeLabels[settings.thumbSize]}</span>
      </label>
      <label className="tier-check">
        <input type="checkbox" checked={settings.showTitles} onChange={e => props.onSettings({ showTitles: e.target.checked })} />
        <span>{t.show_titles}</span>
      </label>
      <label className="tier-check">
        <input type="checkbox" checked={props.isPublic} onChange={e => props.onPublic(e.target.checked)} />
        <span>{t.public_toggle}</span>
      </label>

      <div className="tier-toolbar-group tier-toolbar-group--end">
        <ShareImageButton build={props.buildShareImage} fileName={props.shareFileName} label={props.shareLabel} />
        <button type="button" className="tier-icon-btn" aria-label={t.reset_board} title={t.reset_board} disabled={!props.hasRanked} onClick={props.onReset}>
          <Icon d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
        </button>
        <span className={`tier-save-status tier-save-status--${saveStatus}`} role="status" aria-live="polite">
          {saveStatus === 'saving' && t.saving}
          {saveStatus === 'saved' && t.saved}
          {saveStatus === 'error' && (
            <>
              {t.save_failed.replace('{error}', props.saveError ?? '')}
              <button type="button" className="tier-link-btn" onClick={props.onRetrySave}>{t.retry}</button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
