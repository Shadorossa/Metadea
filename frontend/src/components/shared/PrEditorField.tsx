// Small presentational pieces shared by both collaborative-proposal editors
// (PrEditorModal for media, CharacterPrEditorModal for characters) — a
// labeled field wrapper with a "this differs from the original" dot, used
// throughout both forms' diff-against-original UI.
import type { ReactNode } from 'react';

export const normField = (v: unknown) => (v === '' || v === undefined ? null : v);

export function ChangedDot({ show, className = 'pr-editor-changed-dot' }: { show: boolean; className?: string }) {
  return show ? <span className={className} /> : null;
}

export function Field({ label, changed, small, full, children }: {
  label: string; changed: boolean; small?: boolean; full?: boolean; children: ReactNode;
}) {
  return (
    <div className={`pr-editor-field${small ? ' pr-editor-field--small' : ''}${full ? ' pr-editor-field--full' : ''}`}>
      <label>
        {label}
        <ChangedDot show={changed} />
      </label>
      {children}
    </div>
  );
}
