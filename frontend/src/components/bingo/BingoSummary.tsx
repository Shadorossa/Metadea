// A board's result line: completed cells over its size, percentage and —
// only on a perfect square board — its bingo lines.
import { getT } from '../../i18n/runtime';
import type { BingoResult } from '../../lib/bingo/bingo-result';
import { interpolate } from '../../lib/shared/text/interpolate';

export function bingoLinesLabel(lines: number): string {
  const b = getT().bingo;
  if (lines === 0) return b.lines_none;
  return interpolate(lines === 1 ? b.lines_one : b.lines_other, { n: lines });
}

/** "7/16 completed · 44%", plus " · 2 bingo lines" when the board has lines. */
export function bingoResultLine(result: BingoResult): string {
  const b = getT().bingo;
  const summary = interpolate(b.result_summary, { done: result.done, total: result.size, percent: result.percent });
  return result.hasLines ? `${summary} · ${bingoLinesLabel(result.lines.length)}` : summary;
}

export function BingoSummary({ result }: { result: BingoResult }) {
  const b = getT().bingo;
  return (
    <div className="bingo-summary">
      <div className="bingo-summary-meter" aria-hidden="true">
        <span className="bingo-summary-meter-fill" style={{ width: `${result.percent}%` }} />
      </div>
      <p className="bingo-summary-text">
        <span>{interpolate(b.result_summary, { done: result.done, total: result.size, percent: result.percent })}</span>
        {result.hasLines && (
          <span className={`bingo-summary-lines${result.lines.length > 0 ? ' has-lines' : ''}`}>{bingoLinesLabel(result.lines.length)}</span>
        )}
      </p>
    </div>
  );
}
