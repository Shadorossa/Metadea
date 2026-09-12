import { pickFolder, pickFile } from '../tauri/local-library';
import { STORAGE_KEYS } from '../shared/storage-keys';

interface EmulatorConfig {
  emulator_name: string;
  executable_path: string;
  launch_args: string;
  rom_folder: string;
  tracking_mode: string;
}

interface EmulatorsData {
  [platformId: string]: EmulatorConfig;
}

let emulatorsData: EmulatorsData = {};
let pendingChanges: EmulatorsData = {};
let hasChanges = false;

export async function initEmulators(showToast: (msg?: string) => void) {
  // Load from localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.emulatorsConfig);
    emulatorsData = stored ? JSON.parse(stored) : {};
    pendingChanges = JSON.parse(JSON.stringify(emulatorsData));
  } catch {
    emulatorsData = {};
    pendingChanges = {};
  }

  // File pickers
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

  // Form inputs with pending changes notification
  document.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    const input = target.closest<HTMLInputElement | HTMLSelectElement>('input, select');
    if (!input) return;

    const platformId = input.dataset.platform;
    if (!platformId) return;

    if (!pendingChanges[platformId]) {
      pendingChanges[platformId] = { emulator_name: '', executable_path: '', launch_args: '', rom_folder: '', tracking_mode: 'process' };
    }

    if (input.id.includes('emulator-select')) {
      pendingChanges[platformId].emulator_name = input.value;
    } else if (input.id.includes('launch-args')) {
      pendingChanges[platformId].launch_args = input.value;
    } else if (input.id.includes('tracking-mode')) {
      pendingChanges[platformId].tracking_mode = input.value;
    }

    if (!hasChanges) {
      hasChanges = true;
      showChangeNotification();
    }
  });

  function showChangeNotification() {
    let notification = document.getElementById('emulator-changes-notification');
    if (notification) {
      notification.remove();
    }

    notification = document.createElement('div');
    notification.id = 'emulator-changes-notification';
    notification.style.cssText = `
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 1rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 1rem;
      font-size: 0.9rem;
      color: var(--text-main);
      max-width: 350px;
    `;

    const message = document.createElement('span');
    message.textContent = 'Se han realizado cambios';
    message.style.flex = '1';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Guardar';
    saveBtn.style.cssText = `
      padding: 0.5rem 1rem;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s ease;
    `;
    saveBtn.addEventListener('click', () => {
      emulatorsData = JSON.parse(JSON.stringify(pendingChanges));
      saveEmulators();
      hasChanges = false;
      notification?.remove();
      showToast('Cambios guardados');
    });

    const discardBtn = document.createElement('button');
    discardBtn.textContent = 'Descartar';
    discardBtn.style.cssText = `
      padding: 0.5rem 1rem;
      background: transparent;
      color: var(--text-dim);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s ease;
    `;
    discardBtn.addEventListener('click', () => {
      pendingChanges = JSON.parse(JSON.stringify(emulatorsData));
      hasChanges = false;
      notification?.remove();
      // Reload inputs to show original values
      reloadEmulatorInputs();
      showToast('Cambios descartados');
    });

    notification.appendChild(message);
    notification.appendChild(saveBtn);
    notification.appendChild(discardBtn);
    document.body.appendChild(notification);
  }

  function reloadEmulatorInputs() {
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[id*="launch-args"], select[id*="tracking-mode"], select[id*="emulator-select"]').forEach(input => {
      const platformId = input.dataset.platform;
      if (!platformId || !emulatorsData[platformId]) return;

      if (input.id.includes('emulator-select')) {
        input.value = emulatorsData[platformId].emulator_name || '';
      } else if (input.id.includes('launch-args')) {
        input.value = emulatorsData[platformId].launch_args || '';
      } else if (input.id.includes('tracking-mode')) {
        input.value = emulatorsData[platformId].tracking_mode || 'process';
      }
    });
  }
}

function saveEmulators(): void {
  localStorage.setItem(STORAGE_KEYS.emulatorsConfig, JSON.stringify(emulatorsData));
}

export { emulatorsData };
