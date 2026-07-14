import { useState, type KeyboardEvent } from 'react';

interface TagsInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}

// Comma/Enter-delimited tag chips with a remove button per chip — used by
// the character editor's aliases field.
export function TagsInput({ tags, onChange, placeholder }: TagsInputProps) {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !tags.includes(trimmed)) {
        onChange([...tags, trimmed]);
        setInput('');
      }
    }
  };

  const removeTag = (idx: number) => {
    onChange(tags.filter((_, i) => i !== idx));
  };

  return (
    <div className="tags-input-container">
      <div className="tags-input-wrapper">
        {tags.map((tag, idx) => (
          <div key={idx} className="tags-input-tag">
            {tag}
            <button type="button" onClick={() => removeTag(idx)} className="tags-input-tag-remove">×</button>
          </div>
        ))}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="tags-input-field"
        />
      </div>
    </div>
  );
}
