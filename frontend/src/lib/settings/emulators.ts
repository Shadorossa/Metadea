import { pickFolder, pickFile } from '../tauri/local-library';
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
  // Load from localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.emulatorsConfig);
    emulatorsData = stored ? JSON.parse(stored) : {};
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

      saveEmulators();
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

      saveEmulators();
      showToast('Carpeta de ROMs guardada');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Error: ' + message.slice(0, 50));
    }
  });
}

function saveEmulators(): void {
  localStorage.setItem(STORAGE_KEYS.emulatorsConfig, JSON.stringify(emulatorsData));
}

export { emulatorsData };
