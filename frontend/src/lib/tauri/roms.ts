// IPC for the typed ROM library scan (platform_scanning/rom_library.rs) and
// the automatic file clean-up with undo (rom_rename.rs).
import { invoke, tauriCmd } from './bridge';

export type RomFileKind = 'base' | 'update' | 'dlc';

export interface RomFile {
  path:          string;
  file_name:     string;
  stem:          string;
  extension:     string;
  title_id?:     string | null;
  kind:          RomFileKind;
  // Same-stem companions (.sav, .ml1, save states...) renamed with the ROM.
  sidecars:      string[];
  header_id?:    string | null;
  header_title?: string | null;
}

export interface RomGame {
  platform_id: string;
  // The same synthetic app_id scan_all_games reports for this ROM.
  app_id:      string;
  base:        RomFile;
  updates:     RomFile[];
  dlc:         RomFile[];
  // Multi-disc sets: every disc in boot order (base is the first), the set's
  // .m3u and its name without the disc tag.
  discs?:      RomFile[];
  playlist?:   string | null;
  title_stem?: string | null;
}

export interface RomFolderConfig {
  platform_id:     string;
  rom_folder:      string;
  executable_path: string;
  rom_extensions:  string[];
}

export interface RomScanResult {
  games:   RomGame[];
  folders: RomFolderConfig[];
}

export interface RomRenameItem {
  old_path: string;
  new_path: string;
}

export interface RomRenameOutcome {
  journal_ids: number[];
  renamed:     number;
  skipped:     number;
}

export async function scanRomLibrary(): Promise<RomScanResult> {
  return tauriCmd<RomScanResult>('scan_rom_library', { games: [], folders: [] });
}

// Renames on disk (refusing existing targets, extension changes, anything
// inside the emulator's own directory or outside a configured ROM folder),
// journals every rename and moves links/covers keyed by the old path.
export async function renameRomFiles(items: RomRenameItem[]): Promise<RomRenameOutcome> {
  return invoke<RomRenameOutcome>('rename_rom_files', { items });
}

// Reverts the journal rows from a renameRomFiles outcome; returns how many
// files went back to their previous name.
export async function undoRomRenames(journalIds: number[]): Promise<number> {
  return invoke<number>('undo_rom_renames', { journalIds });
}

export interface RomDiscMergeSummary {
  /** Library entries that now show as one multi-disc game. */
  games:   number;
  /** Old per-disc entries folded into them. */
  entries: number;
}

// Left by the scan that folded old per-disc entries into their multi-disc
// set (rom_disc_merge.rs); cleared on read, so it is shown once.
export async function takeRomDiscMergeSummary(): Promise<RomDiscMergeSummary | null> {
  return tauriCmd<RomDiscMergeSummary | null>('take_rom_disc_merge_summary', null);
}
