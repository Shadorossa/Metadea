import { useState } from 'react';
import { removeLocalGame, type LocalGame } from '../../../lib/tauri';
import type { LocalMediaItem } from './useLocalMediaEntries';

export type LocalDeleteMenu = { x: number; y: number } & (
  | { kind: 'game'; game: LocalGame }
  | { kind: 'library'; item: LocalMediaItem }
);

interface UseLocalDeleteMenuOptions {
  onRemoveGame?: (launcher: string, linkKey: string) => void;
  onDeleteLibraryItem?: (externalId: string) => void;
}

export function useLocalDeleteMenu({
  onRemoveGame,
  onDeleteLibraryItem,
}: UseLocalDeleteMenuOptions) {
  const [deleteMenu, setDeleteMenu] = useState<LocalDeleteMenu | null>(null);

  const requestDeleteGame = (game: LocalGame, x: number, y: number) => {
    setDeleteMenu({ kind: 'game', game, x, y });
  };

  const requestDeleteLibraryItem = (item: LocalMediaItem, x: number, y: number) => {
    setDeleteMenu({ kind: 'library', item, x, y });
  };

  const handleDeleteGame = (game: LocalGame) => {
    const linkKey = game.app_id ?? game.install_path ?? game.name;
    onRemoveGame?.(game.launcher, linkKey);
    removeLocalGame(game.launcher, linkKey).catch(console.error);
    setDeleteMenu(null);
  };

  const handleDeleteLibraryItem = (item: LocalMediaItem) => {
    onDeleteLibraryItem?.(item.externalId);
    setDeleteMenu(null);
  };

  return {
    deleteMenu,
    requestDeleteGame,
    requestDeleteLibraryItem,
    handleDeleteGame,
    handleDeleteLibraryItem,
    closeDeleteMenu: () => setDeleteMenu(null),
  };
}
