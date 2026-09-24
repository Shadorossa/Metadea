import { useState } from 'react';
import { ChartNoAxesGantt, LayoutGrid } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import type { CreatorKind } from '../../lib/media/creator-completion';
import { readCreatorWorksView, saveCreatorWorksView, type CreatorWorksView } from '../../lib/storage/creator-works-view';

/** Grid | Timeline, remembered per page type. The works sections mount
 *  only on the client (after their data loads), so reading storage in the
 *  initial state can't disagree with a server render. */
export function useCreatorWorksView(kind: CreatorKind): [CreatorWorksView, (next: CreatorWorksView) => void] {
  const [view, setView] = useState<CreatorWorksView>(() => readCreatorWorksView(kind));
  const change = (next: CreatorWorksView) => {
    setView(next);
    saveCreatorWorksView(kind, next);
  };
  return [view, change];
}

interface Props {
  view: CreatorWorksView;
  onChange: (next: CreatorWorksView) => void;
  strings: Translations['creator_completion'];
}

// Grid / Timeline as two icon buttons at the right end of the "Works"
// section-title line (author and company pages); the labels are their
// tooltips and accessible names.
export function CreatorViewSwitch({ view, onChange, strings }: Props) {
  const tab = (value: CreatorWorksView, label: string, Icon: typeof LayoutGrid) => (
    <button
      type="button"
      className={`creator-view-tab${view === value ? ' active' : ''}`}
      aria-pressed={view === value}
      aria-label={label}
      title={label}
      onClick={() => onChange(value)}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
  return (
    <div className="creator-view-switch" role="group" aria-label={strings.view_label}>
      {tab('grid', strings.view_grid, LayoutGrid)}
      {tab('timeline', strings.view_timeline, ChartNoAxesGantt)}
    </div>
  );
}
