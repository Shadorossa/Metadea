import { useState } from 'react';

// Click-to-edit text field: a draft that is (re)seeded from `initial` every
// time editing begins or is cancelled, and handed to `onSave` on commit.
// `onSave` decides what a no-op is (trim, empty, unchanged) — the hook only
// owns the editing/draft pair.
export function useInlineEdit(initial: string, onSave: (draft: string) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);

  const begin = () => {
    setDraft(initial);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(initial);
    setEditing(false);
  };

  const commit = () => {
    setEditing(false);
    onSave(draft);
  };

  return { editing, draft, setDraft, begin, cancel, commit };
}
