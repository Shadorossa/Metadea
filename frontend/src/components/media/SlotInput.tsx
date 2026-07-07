import React, { useState, useEffect, useRef } from 'react';

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
  /** Allowed autocomplete values */
  allowedSuggestions?: string[];
  /** Force the input to select only from allowed suggestions */
  restrictToSuggestions?: boolean;
}

/** A comma-separated tag/pill editor — type, press Enter or comma to add,
 *  Backspace on an empty input to pop the last tag, click × to remove one. */
export function SlotInput({
  label, value, onChange, placeholder, preview, fullWidth,
  allowedSuggestions, restrictToSuggestions
}: SlotInputProps) {
  const items = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
  const [inputVal, setInputVal] = useState('');
  const [activeSugIndex, setActiveSugIndex] = useState(0);
  const [showSug, setShowSug] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredSug = allowedSuggestions
    ? allowedSuggestions.filter(
        s =>
          s.toLowerCase().includes(inputVal.toLowerCase()) &&
          !items.includes(s)
      )
    : [];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSug(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addTag = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    if (restrictToSuggestions && allowedSuggestions) {
      // Find exact case-insensitive match from allowed suggestions
      const match = allowedSuggestions.find(s => s.toLowerCase() === trimmed.toLowerCase());
      if (!match) return;
      if (!items.includes(match)) {
        onChange([...items, match].join(','));
      }
    } else {
      if (!items.includes(trimmed)) {
        onChange([...items, trimmed].join(','));
      }
    }
    setInputVal('');
    setShowSug(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showSug) {
        setShowSug(true);
        setActiveSugIndex(0);
      } else {
        setActiveSugIndex(prev => (prev + 1) % Math.max(1, filteredSug.length));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (showSug) {
        setActiveSugIndex(prev => (prev - 1 + filteredSug.length) % Math.max(1, filteredSug.length));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowSug(false);
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (showSug && filteredSug.length > 0) {
        addTag(filteredSug[activeSugIndex]);
      } else {
        addTag(inputVal);
      }
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
    <div className={`pr-editor-field${fullWidth ? ' pr-editor-field--full' : ''}`} ref={containerRef} style={{ position: 'relative' }}>
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
          onChange={e => {
            setInputVal(e.target.value);
            setActiveSugIndex(0);
            setShowSug(true);
          }}
          onFocus={() => {
            if (allowedSuggestions) setShowSug(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {showSug && filteredSug.length > 0 && (
        <div className="pr-editor-suggestions-dropdown">
          {filteredSug.map((sug, idx) => (
            <div
              key={sug}
              className={`pr-editor-suggestion-item${idx === activeSugIndex ? ' pr-editor-suggestion-item--active' : ''}`}
              onClick={() => addTag(sug)}
            >
              {sug}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
