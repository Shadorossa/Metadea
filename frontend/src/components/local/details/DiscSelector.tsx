import { interpolateTranslation } from '../../../lib/i18n-dom/apply-translations';

interface DiscSelectorProps {
  discs: string[];
  selected: string | null;
  onSelect: (discPath: string) => void;
  /** "Disc {n}" */
  discLabel: string;
  /** aria-label of the group. */
  groupLabel: string;
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
}

// [Disc 1] [Disc 2] [Disc 3] under Play, for multi-disc games only: picks
// the disc Play boots (remembered per game, lib/local/disc-choice.ts).
export function DiscSelector({ discs, selected, onSelect, discLabel, groupLabel }: DiscSelectorProps) {
  if (discs.length < 2) return null;
  const current = selected && discs.includes(selected) ? selected : discs[0];
  return (
    <div className="local-disc-selector" role="radiogroup" aria-label={groupLabel}>
      {discs.map((disc, i) => (
        <button
          key={disc}
          type="button"
          role="radio"
          aria-checked={disc === current}
          className={`local-disc-chip${disc === current ? ' is-selected' : ''}`}
          title={fileName(disc)}
          onClick={() => onSelect(disc)}
        >
          {interpolateTranslation(discLabel, { n: i + 1 })}
        </button>
      ))}
    </div>
  );
}
