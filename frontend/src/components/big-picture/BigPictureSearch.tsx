import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import type { BigPictureItem } from '../../lib/big-picture/categories';
import { searchBigPictureItems } from '../../lib/big-picture/categories';
import { clampFocus, moveFocus, type GridPos } from '../../lib/big-picture/focus-grid';
import { ON_SCREEN_KEYBOARD, applyKeyboardKey, type KeyboardKey } from '../../lib/big-picture/on-screen-keyboard';
import { useInputLayer } from './input-layers';

// Result card width + gap (.bp-search-result in big-picture.css).
const RESULT_STEP_PX = 172;
// Clicking a key/result must leave DOM focus in the text field.
const keepFieldFocus = (e: React.MouseEvent) => e.preventDefault();

interface BigPictureSearchProps {
  items: BigPictureItem[];
  t: Translations['big_picture'];
  onPick: (item: BigPictureItem) => void;
  onClose: () => void;
}

function keyLabel(key: KeyboardKey, t: Translations['big_picture']): string {
  switch (key.kind) {
    case 'char': return key.value.toUpperCase();
    case 'space': return t.key_space;
    case 'delete': return t.key_delete;
    case 'clear': return t.key_clear;
    case 'done': return t.key_done;
  }
}

// Y: search. An on-screen keyboard driven by the pad (one focus grid: the
// keyboard rows, then the results as one more row), plus a real text field
// so a physical keyboard types straight into it. A on a result jumps to it.
export function BigPictureSearch({ items, t, onPick, onClose }: BigPictureSearchProps) {
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<GridPos>({ row: 1, col: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchBigPictureItems(items, query), [items, query]);
  const rows = useMemo(() => [...ON_SCREEN_KEYBOARD.map(row => row.length), results.length], [results.length]);
  const focus = clampFocus(rows, pos);
  const resultsRow = ON_SCREEN_KEYBOARD.length;

  // DOM focus stays in the text field (a physical keyboard types into it);
  // the pad's focus is drawn on the cells and exposed as the active
  // descendant.
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);
  const cellId = (row: number, col: number) => `bp-search-cell-${row}-${col}`;

  const press = (key: KeyboardKey) => {
    if (key.kind === 'done') {
      if (results[0]) onPick(results[0]);
      else onClose();
      return;
    }
    setQuery(q => applyKeyboardKey(q, key));
  };

  const activate = (at: GridPos) => {
    if (at.row === resultsRow) {
      const item = results[at.col];
      if (item) onPick(item);
      return;
    }
    const key = ON_SCREEN_KEYBOARD[at.row]?.[at.col];
    if (key) press(key);
  };

  useInputLayer(action => {
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
      setPos(moveFocus(rows, focus, action, { wrapHorizontal: focus.row !== resultsRow }));
    } else if (action === 'confirm') {
      activate(focus);
    } else if (action === 'details') {
      setQuery(q => applyKeyboardKey(q, { kind: 'delete' }));
    } else if (action === 'back' || action === 'search') {
      onClose();
    }
  });

  return (
    <div className="bp-search" role="dialog" aria-label={t.search_title}>
      <label className="bp-search-field">
        <Search size={26} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={t.search_placeholder}
          aria-label={t.search_title}
          aria-activedescendant={cellId(focus.row, focus.col)}
          onChange={e => {
            setQuery(e.target.value.slice(0, 60));
            // Typing on a real keyboard: jump to the results row.
            setPos({ row: resultsRow, col: 0 });
          }}
        />
      </label>

      <div className="bp-osk">
        {ON_SCREEN_KEYBOARD.map((row, r) => (
          <div key={r} className="bp-osk-row">
            {row.map((key, c) => (
              <button
                key={c}
                id={cellId(r, c)}
                type="button"
                className={`bp-osk-key bp-osk-key--${key.kind}${focus.row === r && focus.col === c ? ' is-focused' : ''}`}
                tabIndex={-1}
                onMouseDown={keepFieldFocus}
                onClick={() => { setPos({ row: r, col: c }); activate({ row: r, col: c }); }}
              >
                {keyLabel(key, t)}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="bp-search-results">
        {query.trim() && results.length === 0 && <p className="bp-search-empty">{t.search_no_results}</p>}
        <div className="bp-search-track" style={{ transform: `translate3d(${focus.row === resultsRow ? -Math.max(0, focus.col - 2) * RESULT_STEP_PX : 0}px, 0, 0)` }}>
          {results.map((item, i) => (
            <button
              key={item.key}
              id={cellId(resultsRow, i)}
              type="button"
              className={`bp-search-result${focus.row === resultsRow && focus.col === i ? ' is-focused' : ''}`}
              tabIndex={-1}
              aria-label={item.title}
              onMouseDown={keepFieldFocus}
              onClick={() => onPick(item)}
            >
              {item.cover ? <img src={item.cover} alt="" loading="lazy" decoding="async" /> : <span className="bp-search-result-fallback">{item.title}</span>}
              <span className="bp-search-result-title">{item.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
