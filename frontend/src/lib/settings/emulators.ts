import { pickFolder, pickFile } from '../tauri/local-library';
import { readStoredJson, writeStoredJson } from '../tauri/core';
import { STORAGE_KEYS } from '../shared/storage-keys';

interface EmulatorConfig {
  executable_path: string;
  launch_args: string;
  rom_folder: string;
  tracking_mode: string;
}

interface EmulatorsData {
  [platformId: string]: EmulatorConfig;
}

let emulatorsData: EmulatorsData = {};

export async function initEmulators(showToast: (msg?: string) => void) {
  try {
    emulatorsData = await loadEmulators();
  } catch {
    emulatorsData = {};
  }

  document.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.exe-picker-btn');
    if (!btn) return;

    const platformId = btn.dataset.platform;
    if (!platformId) return;

    try {
      const chosen = await pickFile().catch(() => null);
      if (!chosen) return;

      if (!emulatorsData[platformId]) {
        emulatorsData[platformId] = { executable_path: '', launch_args: '', rom_folder: '', tracking_mode: 'process' };
      }
      emulatorsData[platformId].executable_path = chosen;

      await saveEmulators();
      showToast('Ejecutable guardado');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Error: ' + message.slice(0, 50));
    }
  });

  document.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.rom-folder-btn');
    if (!btn) return;

    const platformId = btn.dataset.platform;
    if (!platformId) return;

    try {
      const chosen = await pickFolder().catch(() => null);
      if (!chosen) return;

      if (!emulatorsData[platformId]) {
        emulatorsData[platformId] = { executable_path: '', launch_args: '', rom_folder: '', tracking_mode: 'process' };
      }
      emulatorsData[platformId].rom_folder = chosen;

      await saveEmulators();
      showToast('Carpeta de ROMs guardada');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Error: ' + message.slice(0, 50));
    }
  });
}

async function loadEmulators(): Promise<EmulatorsData> {
  return readStoredJson<EmulatorsData>('read_emulators_config', STORAGE_KEYS.emulatorsConfig, {});
}

async function saveEmulators(): Promise<void> {
  return writeStoredJson('write_emulators_config', STORAGE_KEYS.emulatorsConfig, emulatorsData, emulatorsData);
}

export { emulatorsData };
