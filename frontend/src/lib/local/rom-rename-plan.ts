// The clean-up rename plan computed from a typed ROM scan (scanRomLibrary):
// which files get a clean name and what it is. Pure — the Rust command
// (rename_rom_files) re-validates every item against the disk (existing
// target, emulator directory, extension) before touching anything.
//
// Clean names:
//   Switch base    -> "<Clean Title> [<titleId>]"
//   Switch update  -> "<Clean Title> [<titleId>][v<version>]"  (the version
//                     is what tells two update dumps apart)
//   Switch DLC     -> "<Clean Title> [<DLC name>] [<titleId>]"
//   anything else  -> "<Clean Title>"
// The title id is kept because it's what groups DLC/updates under their
// base. Same-stem sidecars (.sav, .ml1, save states...) follow the ROM.

import type { RomFile, RomRenameItem, RomScanResult } from '../tauri/roms';
import { parseRomFileName } from './rom-name-parser';

export function cleanStemFor(file: RomFile, platformId: string): string {
  const parsed = parseRomFileName(file.stem);
  if (platformId !== 'switch' || !parsed.titleId) return parsed.fileTitle;
  const kind = file.kind;
  if (kind === 'dlc' && parsed.dlcName) return `${parsed.fileTitle} [${parsed.dlcName}] [${parsed.titleId}]`;
  if (kind === 'update' && parsed.version) return `${parsed.fileTitle} [${parsed.titleId}][v${parsed.version}]`;
  return `${parsed.fileTitle} [${parsed.titleId}]`;
}

function splitPath(path: string): { dir: string; name: string } {
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return idx < 0 ? { dir: '', name: path } : { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

function renamesFor(file: RomFile, platformId: string): RomRenameItem[] {
  const newStem = cleanStemFor(file, platformId);
  // A case-only change isn't worth a rename (and can't be done in one step
  // on a case-insensitive file system).
  if (!newStem || newStem.toLowerCase() === file.stem.toLowerCase()) return [];
  const { dir } = splitPath(file.path);
  const items: RomRenameItem[] = [{ old_path: file.path, new_path: `${dir}${newStem}.${file.extension}` }];
  for (const sidecar of file.sidecars) {
    const { name } = splitPath(sidecar);
    if (name.length <= file.stem.length) continue;
    const suffix = name.slice(file.stem.length);
    items.push({ old_path: sidecar, new_path: `${dir}${newStem}${suffix}` });
  }
  return items;
}

export function buildRomRenamePlan(scan: RomScanResult): RomRenameItem[] {
  const plan: RomRenameItem[] = [];
  const targets = new Set<string>();
  for (const game of scan.games) {
    for (const file of [game.base, ...game.updates, ...game.dlc]) {
      const items = renamesFor(file, game.platform_id);
      // Two dumps of the same game ("(USA)" and "(Europe)") would collapse
      // onto one clean name: the first keeps it, the rest stay as they are.
      if (items.some(item => targets.has(item.new_path.toLowerCase()))) continue;
      for (const item of items) targets.add(item.new_path.toLowerCase());
      plan.push(...items);
    }
  }
  return plan;
}
