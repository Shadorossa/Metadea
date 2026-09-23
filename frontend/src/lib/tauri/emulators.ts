import { invoke, tauriCmd } from './bridge';
import type { LocalScreenshot } from './anime-local';

export interface EmulatorConfig {
  emulator_name: string;
  executable_path: string;
  launch_args: string;
  rom_folder: string;
  /** Legacy persisted field; monitoring is fixed to process mode. */
  tracking_mode: string;
  /** Extensions (lowercase, no dot) the ROM scanner considers; always the
   *  effective list when read (the platform default when never customised). */
  rom_extensions: string[];
  /** Folder the emulator writes screenshots to; '' = auto-detected from the
   *  executable's layout (see emulators::default_screenshots_dirs). */
  screenshots_dir: string;
}

export interface EmulatorScreenshots {
  screenshots: LocalScreenshot[];
  // false when nothing in the folder could be tied to this game, so the
  // list is the emulator's recent captures for the platform instead.
  filtered: boolean;
}

export async function readEmulatorsConfig(): Promise<Record<string, EmulatorConfig>> {
  return invoke('read_emulators_config');
}

// The emulator's own captures for a ROM (see get_emulator_screenshots);
// empty when the platform has no emulator or no capture folder resolves.
export async function getEmulatorScreenshots(
  platformId: string,
  romPath: string,
  options: { headerId?: string | null; title?: string | null } = {},
): Promise<EmulatorScreenshots> {
  return tauriCmd<EmulatorScreenshots>('get_emulator_screenshots', { screenshots: [], filtered: true }, {
    platformId,
    romPath,
    headerId: options.headerId ?? null,
    title: options.title ?? null,
  });
}

export async function writeEmulatorsConfig(configs: Record<string, EmulatorConfig>): Promise<string> {
  return invoke('write_emulators_config', { configs });
}
