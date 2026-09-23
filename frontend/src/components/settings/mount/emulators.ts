import { pickFolder, pickFile } from '../../../lib/tauri/local-library';
import { getT } from '../../../i18n/runtime';
import { invoke, tauriCmd } from '../../../lib/tauri/bridge';
import { isRomAutoRenameEnabled, setRomAutoRenameEnabled } from '../../../lib/storage/preferences';

interface EmulatorConfig {
  emulator_name: string;
  executable_path: string;
  launch_args: string;
  rom_folder: string;
  /** Kept for database compatibility; emulator sessions are always process-monitored. */
  tracking_mode: string;
  /** Read-only: the chosen emulator's compatible extensions, which the ROM
   *  scanner uses (emulators::scan_rom_extensions). Never edited here. */
  rom_extensions: string[];
  /** Emulator screenshot folder; '' = auto-detected from the executable's layout. */
  screenshots_dir: string;
}

const EMPTY_CONFIG: EmulatorConfig = { emulator_name: '', executable_path: '', launch_args: '', rom_folder: '', tracking_mode: 'process', rom_extensions: [], screenshots_dir: '' };

interface EmulatorsData {
  [platformId: string]: EmulatorConfig;
}

let emulatorsData: EmulatorsData = {};
let pendingChanges: EmulatorsData = {};
let hasChanges = false;
let listenersAttached = false;

export async function initEmulators(showToast: (msg?: string) => void) {
  // Load from database via Tauri, with fallback to empty object
  try {
    const stored = await tauriCmd<Record<string, EmulatorConfig>>('read_emulators_config', {});
    emulatorsData = stored || {};
    pendingChanges = JSON.parse(JSON.stringify(emulatorsData));
  } catch (err) {
    console.error('[Init] Error loading data:', err);
    emulatorsData = {};
    pendingChanges = {};
  }

  // Load saved values into inputs after a short delay to ensure DOM is ready
  setTimeout(() => {
    loadEmulatorInputs();
  }, 100);

  // local.roms.auto_rename — a plain per-device preference, saved on toggle
  // (not part of the emulator configs' pending-changes flow).
  const autoRename = document.getElementById('roms-auto-rename');
  if (autoRename instanceof HTMLInputElement) {
    autoRename.checked = isRomAutoRenameEnabled();
    autoRename.addEventListener('change', () => {
      setRomAutoRenameEnabled(autoRename.checked);
      showToast(getT().settings.env_saved);
    });
  }

  if (listenersAttached) return;
  listenersAttached = true;

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
        showToast(getT().settings.emulators_exe_only);
        return;
      }

      if (!pendingChanges[platformId]) {
        pendingChanges[platformId] = { ...EMPTY_CONFIG };
      }
      pendingChanges[platformId].executable_path = chosen;

      if (!hasChanges) {
        hasChanges = true;
        showChangeNotification();
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(getT().settings.error_with_message.replace('{message}', message.slice(0, 50)));
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
        pendingChanges[platformId] = { ...EMPTY_CONFIG };
      }
      // The same folder button serves the ROM folder and, with
      // data-field="screenshots-dir", the emulator's screenshot folder.
      if (btn.dataset.field === 'screenshots-dir') {
        pendingChanges[platformId].screenshots_dir = chosen;
        const input = document.getElementById(`screenshots-dir-${platformId}`);
        if (input instanceof HTMLInputElement) input.value = chosen;
      } else {
        pendingChanges[platformId].rom_folder = chosen;

        // Update display immediately
        const display = document.getElementById(`rom-folder-display-${platformId}`);
        if (display) {
          display.textContent = chosen;
          display.style.display = 'block';
        }
      }

      if (!hasChanges) {
        hasChanges = true;
        showChangeNotification();
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(getT().settings.error_with_message.replace('{message}', message.slice(0, 50)));
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
      pendingChanges[platformId] = { ...EMPTY_CONFIG };
    }

    // Check by class and ID patterns
    if (input.classList.contains('emulator-select')) {
      pendingChanges[platformId].emulator_name = input.value;
    } else if (input.id.includes('launch-args')) {
      pendingChanges[platformId].launch_args = input.value;
    } else if (input.id.includes('screenshots-dir')) {
      pendingChanges[platformId].screenshots_dir = input.value.trim();
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
    message.textContent = getT().settings.emulators_unsaved_notice;
    message.style.fontWeight = '500';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = getT().settings.env_save;
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
    saveBtn.addEventListener('click', async () => {
      emulatorsData = JSON.parse(JSON.stringify(pendingChanges));
      await saveEmulators();
      window.dispatchEvent(new CustomEvent('emulators-config-reset', { detail: emulatorsData }));
      hasChanges = false;
      notification.style.opacity = '0';
      setTimeout(() => notification?.remove(), 300);
      showToast(getT().settings.env_saved);
    });

    const discardBtn = document.createElement('button');
    discardBtn.textContent = getT().pr_editor.discard;
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
      window.dispatchEvent(new CustomEvent('emulators-config-reset', { detail: emulatorsData }));
      hasChanges = false;
      notification.style.opacity = '0';
      setTimeout(() => {
        notification?.remove();
        loadEmulatorInputs();
      }, 300);
      showToast(getT().settings.emulators_changes_discarded);
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
      if (!platformId) return;

      if (input.classList.contains('emulator-select')) {
        input.value = emulatorsData[platformId]?.emulator_name || '';
      } else if (input.id.includes('launch-args')) {
        const savedValue = emulatorsData[platformId]?.launch_args || '';
        input.value = savedValue;
      } else if (input.id.includes('screenshots-dir')) {
        input.value = emulatorsData[platformId]?.screenshots_dir ?? '';
      } else if (input.id.includes('rom-folder')) {
        const savedValue = emulatorsData[platformId]?.rom_folder || '';
        input.value = savedValue;
        // Update ROM folder display
        if (savedValue) {
          updateRomFolderDisplay(platformId);
        }
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

async function saveEmulators(): Promise<void> {
  try {
    for (const config of Object.values(emulatorsData)) {
      config.tracking_mode = 'process';
    }
    await invoke('write_emulators_config', { configs: emulatorsData });
  } catch (err) {
    console.error('[Save] Error saving emulators:', err);
    throw err;
  }
}

export { emulatorsData };
