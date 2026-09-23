import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { resolveEpisodeClickRange, type StoryArcDisplayUnit, type UnifiedEpisode } from '../../../lib/media/editor/story-arc-units';
import { getT } from '../../../i18n/runtime';

interface Props {
  unit: StoryArcDisplayUnit;
  unifiedEps: UnifiedEpisode[];
  globalStart: number | null;
  globalEnd: number | null;
  position: { top: number; left: number };
  // Sets the unit's episode range in unified (cross-work) episode numbers;
  // null on both ends clears it.
  onApplyRange: (startGen: number | null, endGen: number | null) => void;
}

// Episode-range picker for one story-arc unit, portaled next to the unit's
// trigger button: from/to selects, a clear button, and the episode list where
// a click sets the start and Ctrl+click the end. The parent owns which unit
// is open and closes it on outside clicks (by class name), so the popover
// only stops its own clicks from bubbling.
export function PrEditorEpisodePopover({ unit, unifiedEps, globalStart, globalEnd, position, onApplyRange }: Props) {
  const t = getT().pr_editor.story_arcs;
  const epLabel = (n: number) => t.ep_single.replace('{n}', String(n));

  const rangeSelect = (value: number | null, emptyLabel: string, onPick: (val: number | null) => void) => (
    <select
      className="pr-editor-arc-ep-select"
      value={value ?? ''}
      onChange={e => onPick(e.target.value === '' ? null : parseInt(e.target.value, 10))}
    >
      <option value="">{emptyLabel}</option>
      {unifiedEps.map(ep => (
        <option key={ep.generalEpNumber} value={ep.generalEpNumber}>
          {epLabel(ep.generalEpNumber)}
        </option>
      ))}
    </select>
  );

  return createPortal(
    <div
      className="pr-editor-arc-ep-popover"
      style={{ top: position.top, left: position.left }}
      onClick={e => e.stopPropagation()}
    >
      <div className="pr-editor-arc-ep-range-row">
        <div className="pr-editor-arc-ep-range-field">
          <span className="pr-editor-arc-ep-range-label">{t.range_from}</span>
          {rangeSelect(globalStart, t.range_start_empty, val => onApplyRange(val, globalEnd ?? val))}
        </div>

        <div className="pr-editor-arc-ep-range-field">
          <span className="pr-editor-arc-ep-range-label">{t.range_to}</span>
          {rangeSelect(globalEnd, t.range_end_empty, val => onApplyRange(globalStart ?? unifiedEps[0]?.generalEpNumber ?? val, val))}
        </div>

        <button
          type="button"
          className="pr-editor-arc-ep-clear-btn"
          onClick={() => onApplyRange(null, null)}
          title={t.clear_range}
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="pr-editor-arc-ep-list">
        {unifiedEps.map(ep => {
          const isSelected = globalStart != null && globalEnd != null
            && ep.generalEpNumber >= Math.min(globalStart, globalEnd)
            && ep.generalEpNumber <= Math.max(globalStart, globalEnd);
          return (
            <button
              type="button"
              key={ep.generalEpNumber}
              className={`pr-editor-arc-ep-item ${isSelected ? 'is-selected' : ''}`}
              title={t.ep_click_hint}
              onClick={e => {
                const { start, end } = resolveEpisodeClickRange(ep.generalEpNumber, globalStart, globalEnd, e.ctrlKey || e.metaKey);
                onApplyRange(start, end);
              }}
            >
              {ep.coverUrl ? (
                <img className="pr-editor-arc-ep-thumb" src={ep.coverUrl} alt="" />
              ) : (
                <div className="pr-editor-arc-ep-thumb" />
              )}
              <div className="pr-editor-arc-ep-info">
                <span className="pr-editor-arc-ep-name">
                  {epLabel(ep.generalEpNumber)}{ep.name ? ` · ${ep.name}` : ''}
                  {(unit.isGroup || ep.generalEpNumber !== ep.seasonEpNumber) && (
                    <> (<strong className="pr-editor-arc-ep-season-num">{epLabel(ep.seasonEpNumber)}</strong>)</>
                  )}
                </span>
                {unit.isGroup && (
                  <span className="pr-editor-arc-ep-sub">{ep.mediaTitle}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
