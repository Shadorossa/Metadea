import { useMemo } from 'react';
import type { Translations } from '../../i18n/index';
import {
  computeCreatorCompletion,
  creatorCompletionDetails,
  creatorCompletionHeadline,
  isCreatorCompletionVisible,
  type CreatorKind,
  type CreatorWorkRef,
} from '../../lib/media/creator-completion';
import type { LibrarySnapshot } from './hooks/useLibrarySnapshot';

interface Props {
  kind: CreatorKind;
  name: string;
  works: readonly CreatorWorkRef[];
  snapshot: LibrarySnapshot | null;
  includeExtras?: boolean;
  strings: Translations['creator_completion'];
}

// "How much of this author's / company's work have you finished" — the
// SagaCompletionBar meter (same .saga-completion structure and styles) for
// a creator header. Hidden until the snapshot loads, and when the user has
// none of the works in any list.
export function CreatorCompletionBar({ kind, name, works, snapshot, includeExtras = false, strings }: Props) {
  const result = useMemo(() => (snapshot
    ? computeCreatorCompletion(works, snapshot.libraryById, { includeExtras, catalogById: snapshot.catalogById })
    : null), [works, snapshot, includeExtras]);

  if (!result || !isCreatorCompletionVisible(result)) return null;

  return (
    <div className="saga-completion creator-completion" role="group" aria-label={strings.label} tabIndex={0}>
      <div className="saga-completion-row">
        <span className="saga-completion-headline">{creatorCompletionHeadline(result, kind, name, strings)}</span>
        <span className="saga-completion-percent">{result.percent} %</span>
      </div>
      <div
        className="saga-completion-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={result.percent}
      >
        <div className="saga-completion-fill" style={{ width: `${result.percent}%` }} />
      </div>
      <div className="saga-completion-tooltip" role="tooltip">
        {creatorCompletionDetails(result, strings).map(line => <span key={line}>{line}</span>)}
      </div>
    </div>
  );
}
