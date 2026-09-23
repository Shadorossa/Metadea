import { glyphFor, type HintButton, type InputDevice } from '../../lib/big-picture/glyphs';

export interface Hint {
  button: HintButton;
  label: string;
}

export function ButtonGlyph({ device, button }: { device: InputDevice; button: HintButton }) {
  const glyph = glyphFor(device, button);
  const wide = glyph.label.length > 1;
  return (
    <span className={`bp-glyph bp-glyph--${device}${glyph.tone ? ` bp-glyph--${glyph.tone}` : ''}${wide ? ' bp-glyph--wide' : ''}`} aria-hidden="true">
      {glyph.label}
    </span>
  );
}

// Bottom hint bar: what each button does right now, drawn with the glyphs
// of whatever was used last (Xbox, PlayStation, Nintendo, keyboard).
export function BigPictureHints({ device, hints }: { device: InputDevice; hints: Hint[] }) {
  return (
    <div className="bp-hints">
      {hints.map(hint => (
        <span key={hint.button} className="bp-hint">
          <ButtonGlyph device={device} button={hint.button} />
          <span>{hint.label}</span>
        </span>
      ))}
    </div>
  );
}
