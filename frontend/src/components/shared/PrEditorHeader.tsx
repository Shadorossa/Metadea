import type { ReactNode } from 'react';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions: ReactNode;
}

/** Shared title/status/actions frame for both collaborative editors. */
export function PrEditorHeader({ title, subtitle, status, actions }: Props) {
  return (
    <header className="pr-editor-header pr-editor-header--row">
      <div className="pr-editor-header-titles">
        <span className="pr-editor-title">{title}</span>
        {subtitle != null && <span className="pr-editor-subtitle">{subtitle}</span>}
      </div>
      <div className="pr-editor-header-actions">
        {status}
        {actions}
      </div>
    </header>
  );
}
