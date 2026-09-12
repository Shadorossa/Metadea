import { invoke } from './core';

export interface EmulatorConfig {
  emulator_name: string;
  executable_path: string;
  launch_args: string;
  rom_folder: string;
  tracking_mode: string;
}

export async function readEmulatorsConfig(): Promise<Record<string, EmulatorConfig>> {
  return invoke('read_emulators_config');
}

export async function writeEmulatorsConfig(configs: Record<string, EmulatorConfig>): Promise<string> {
  return invoke('write_emulators_config', { configs });
}
