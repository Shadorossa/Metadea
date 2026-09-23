import { useState } from 'react';
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

// "Grid | Timeline" text tabs, same look as Home's "Friends | General".
export function CreatorViewSwitch({ view, onChange, strings }: Props) {
  const tab = (value: CreatorWorksView, label: string) => (
    <button
      type="button"
      className={`creator-view-tab${view === value ? ' active' : ''}`}
      aria-pressed={view === value}
      onClick={() => onChange(value)}
    >
      {label}
    </button>
  );
  return (
    <div className="creator-view-switch" role="group" aria-label={strings.view_label}>
      {tab('grid', strings.view_grid)}
      <span className="creator-view-divider" aria-hidden="true">|</span>
      {tab('timeline', strings.view_timeline)}
    </div>
  );
}
