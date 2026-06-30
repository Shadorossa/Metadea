import React from 'react';
import { type LocalFolderEntry } from '../../../lib/tauri';
import { IconFolder, IconFile } from '../ui/icons';
import { formatBytes } from '../utils/formatters';

interface FolderEntryCardProps {
  entry: LocalFolderEntry;
}

export function FolderEntryCard({ entry }: FolderEntryCardProps) {
  return (
    <div className="local-folder-entry">
      <div className="local-folder-entry-icon">
        {entry.is_dir ? <IconFolder /> : <IconFile />}
      </div>
      <div className="local-folder-entry-info">
        <p className="local-folder-entry-name">{entry.name}</p>
        <p className="local-folder-entry-meta">
          {entry.is_dir ? `${entry.child_count ?? 0} elementos` : formatBytes(entry.size)}
        </p>
      </div>
    </div>
  );
}
