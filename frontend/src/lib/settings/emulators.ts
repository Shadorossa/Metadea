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

  // Load saved values into inputs on page load
  loadEmulatorInputs();

  // File pickers
  document.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.exe-picker-btn');
    if (!btn) return;

    const platformId = btn.dataset.platform;
    if (!platformId) return;

    try {
      const chosen = await pickFile().catch(() => null);
      if (!chosen) return;

      // Filter for .exe files only
      if (!chosen.toLowerCase().endsWith('.exe')) {
        showToast('Solo se permiten archivos .exe');
        return;
      }

      if (!pendingChanges[platformId]) {
        pendingChanges[platformId] = { emulator_name: '', executable_path: '', launch_args: '', rom_folder: '', tracking_mode: 'process' };
      }
      pendingChanges[platformId].executable_path = chosen;

      if (!hasChanges) {
        hasChanges = true;
        showChangeNotification();
      }

      console.log(`[Executable] ${platformId}: ${chosen}`);
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

      if (!pendingChanges[platformId]) {
        pendingChanges[platformId] = { emulator_name: '', executable_path: '', launch_args: '', rom_folder: '', tracking_mode: 'process' };
      }
      pendingChanges[platformId].rom_folder = chosen;

      // Update display immediately
      const display = document.getElementById(`rom-folder-display-${platformId}`);
      if (display) {
        display.textContent = chosen;
        display.style.display = 'block';
      }

      if (!hasChanges) {
        hasChanges = true;
        showChangeNotification();
      }

      console.log(`[ROM Folder] ${platformId}: ${chosen}`);
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

    // Check by class and ID patterns
    if (input.classList.contains('emulator-select')) {
      pendingChanges[platformId].emulator_name = input.value;
      console.log(`[Emulator] ${platformId}: ${input.value}`);
    } else if (input.id.includes('launch-args')) {
      pendingChanges[platformId].launch_args = input.value;
      console.log(`[Launch Args] ${platformId}: ${input.value}`);
    } else if (input.id.includes('tracking-mode')) {
      pendingChanges[platformId].tracking_mode = input.value;
      console.log(`[Tracking Mode] ${platformId}: ${input.value}`);
    }

    if (!hasChanges) {
      hasChanges = true;
      showChangeNotification();
    }
  });

  function showChangeNotification() {
    let notification = document.getElementById('emulator-changes-notification');
    if (notification) {
      notification.style.opacity = '0';
      notification.style.pointerEvents = 'none';
      setTimeout(() => notification?.remove(), 300);
    }

    notification = document.createElement('div');
    notification.id = 'emulator-changes-notification';
    notification.style.cssText = `
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-elevated);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 1.2rem 1.5rem;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 1.5rem;
      font-size: 0.9rem;
      color: var(--text-main);
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;

    const message = document.createElement('span');
    message.textContent = 'Se han realizado cambios';
    message.style.fontWeight = '500';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Guardar';
    saveBtn.style.cssText = `
      padding: 0.5rem 1.2rem;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      transition: all 0.2s ease;
    `;
    saveBtn.addEventListener('mouseover', () => {
      saveBtn.style.opacity = '0.9';
      saveBtn.style.transform = 'scale(1.05)';
    });
    saveBtn.addEventListener('mouseout', () => {
      saveBtn.style.opacity = '1';
      saveBtn.style.transform = 'scale(1)';
    });
    saveBtn.addEventListener('click', () => {
      emulatorsData = JSON.parse(JSON.stringify(pendingChanges));
      saveEmulators();
      hasChanges = false;
      notification.style.opacity = '0';
      setTimeout(() => notification?.remove(), 300);
      showToast('Cambios guardados');
    });

    const discardBtn = document.createElement('button');
    discardBtn.textContent = 'Descartar';
    discardBtn.style.cssText = `
      padding: 0.5rem 1.2rem;
      background: transparent;
      color: var(--text-dim);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      transition: all 0.2s ease;
    `;
    discardBtn.addEventListener('mouseover', () => {
      discardBtn.style.borderColor = 'var(--accent)';
      discardBtn.style.color = 'var(--accent)';
    });
    discardBtn.addEventListener('mouseout', () => {
      discardBtn.style.borderColor = 'var(--border-color)';
      discardBtn.style.color = 'var(--text-dim)';
    });
    discardBtn.addEventListener('click', () => {
      pendingChanges = JSON.parse(JSON.stringify(emulatorsData));
      hasChanges = false;
      notification.style.opacity = '0';
      setTimeout(() => {
        notification?.remove();
        loadEmulatorInputs();
      }, 300);
      showToast('Cambios descartados');
    });

    notification.appendChild(message);
    notification.appendChild(saveBtn);
    notification.appendChild(discardBtn);
    document.body.appendChild(notification);

    // Trigger transition after adding to DOM
    requestAnimationFrame(() => {
      notification.style.opacity = '1';
    });
  }

  function loadEmulatorInputs() {
    document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => {
      const platformId = input.dataset.platform;
      if (!platformId || !emulatorsData[platformId]) return;

      if (input.classList.contains('emulator-select')) {
        input.value = emulatorsData[platformId].emulator_name || '';
      } else if (input.id.includes('launch-args')) {
        input.value = emulatorsData[platformId].launch_args || '';
      } else if (input.id.includes('tracking-mode')) {
        input.value = emulatorsData[platformId].tracking_mode || 'process';
      } else if (input.id.includes('rom-folder')) {
        input.value = emulatorsData[platformId].rom_folder || '';
        // Update ROM folder display
        updateRomFolderDisplay(platformId);
      }
    });
  }

  function updateRomFolderDisplay(platformId: string) {
    const display = document.getElementById(`rom-folder-display-${platformId}`);
    if (!display) return;

    const romFolder = emulatorsData[platformId]?.rom_folder;
    if (romFolder) {
      display.textContent = romFolder;
      display.style.display = 'block';
    } else {
      display.style.display = 'none';
    }
  }
}

function saveEmulators(): void {
  localStorage.setItem(STORAGE_KEYS.emulatorsConfig, JSON.stringify(emulatorsData));
}

export { emulatorsData };
