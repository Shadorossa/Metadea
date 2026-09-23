import { invoke, tauriCmd } from './bridge';

export interface EmulatorConfig {
  emulator_name: string;
  executable_path: string;
  launch_args: string;
  rom_folder: string;
  /** Legacy persisted field; monitoring is fixed to process mode. */
  tracking_mode: string;
  /** Read-only: the extensions (lowercase, no dot) the ROM scanner uses,
   *  i.e. the chosen emulator's compatible list, or the platform default
   *  without a known emulator (emulators::scan_rom_extensions). */
  rom_extensions: string[];
  /** Override of the folder the emulator itself writes screenshots to (the
   *  SOURCE they are moved from), for emulators not auto-detected; '' =
   *  detected from the executable's layout (emulators::default_screenshots_dirs).
   *  Captures always end up in Pictures/Metadea/<game>/. */
  screenshots_dir: string;
}

export async function readEmulatorsConfig(): Promise<Record<string, EmulatorConfig>> {
  return invoke('read_emulators_config');
}

// Moves this ROM's captures still sitting in the emulator's own folder into
// Pictures/Metadea/<title>/ (see import_emulator_screenshots), where
// getLocalScreenshots lists them; resolves to how many were moved. A no-op
// once done, since moved captures are gone from the emulator's folder.
export async function importEmulatorScreenshots(
  platformId: string,
  romPath: string,
  title: string,
  headerId?: string | null,
): Promise<number> {
  return tauriCmd<number>('import_emulator_screenshots', 0, {
    platformId,
    romPath,
    title,
    headerId: headerId ?? null,
  });
}

export async function writeEmulatorsConfig(configs: Record<string, EmulatorConfig>): Promise<string> {
  return invoke('write_emulators_config', { configs });
}
