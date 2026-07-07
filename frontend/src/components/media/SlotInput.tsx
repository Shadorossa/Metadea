import React, { useState } from 'react';

export interface SlotInputProps {
  label: string;
  value: string | null | undefined;
  onChange: (newValue: string | null) => void;
  placeholder?: string;
  /** Render each item as an image thumbnail (loaded from the item itself as
   *  a URL) instead of a plain text pill — used for banner URLs, where the
   *  raw string is meaningless to a reviewer but the image it points to
   *  isn't. */
  preview?: boolean;
  /** Span both grid columns instead of sharing a row with another field —
   *  only worth it for image-preview lists (thumbnails need the room); plain
   *  tag lists default to half-width so two of them share a row instead of
   *  each claiming a full row and stacking the whole form tall. */
  fullWidth?: boolean;
}

/** A comma-separated tag/pill editor — type, press Enter or comma to add,
 *  Backspace on an empty input to pop the last tag, click × to remove one. */
export function SlotInput({ label, value, onChange, placeholder, preview, fullWidth }: SlotInputProps) {
  const items = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const [inputVal, setInputVal] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = inputVal.trim();
      if (val && !items.includes(val)) {
        const next = [...items, val].join(',');
        onChange(next);
      }
      setInputVal('');
    } else if (e.key === 'Backspace' && !inputVal && items.length > 0) {
      const next = items.slice(0, -1).join(',');
      onChange(next || null);
    }
  };

  const handleRemove = (itemToRemove: string) => {
    const next = items.filter(i => i !== itemToRemove).join(',');
    onChange(next || null);
  };

  return (
    <div className={`pr-editor-field${fullWidth ? ' pr-editor-field--full' : ''}`}>
      <label>{label}</label>
      <div className={`pr-editor-slots-box${preview ? ' pr-editor-slots-box--preview' : ''}`}>
        {items.map(item => (
          preview ? (
            <div key={item} className="pr-editor-image-slot">
              <div className="pr-editor-image-slot-media">
                <img src={item} alt="" className="pr-editor-image-slot-img" />
                <button type="button" className="pr-editor-image-slot-remove" onClick={() => handleRemove(item)}>×</button>
              </div>
              <span className="pr-editor-image-slot-url" title={item}>{item}</span>
            </div>
          ) : (
            <span key={item} className="pr-editor-slot-pill">
              {item}
              <button type="button" className="pr-editor-slot-remove" onClick={() => handleRemove(item)}>×</button>
            </span>
          )
        ))}
        <input
          type="text"
          className="pr-editor-slot-input"
          placeholder={placeholder || 'Press Enter or comma to add...'}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
