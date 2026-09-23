// Settings › Accessibility › Break reminder + Clock alerts
// (BreakReminderSettings.astro). Every change saves straight away; Rust
// returns the stored (normalised) settings, which are rendered back.
import { getT } from '../../../i18n/runtime';
import { formatAppError } from '../../../lib/errors/format-error';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { getLocaleCode } from '../../../lib/shared/text/format-date';
import {
  addClockAlert, formatClockTime, intervalHoursValue, parseIntervalHours, MAX_CLOCK_ALERTS,
} from '../../../lib/local/break-reminder';
import {
  getBreakReminderSettings, setBreakReminderSettings, type BreakReminderSettings, type ClockAlert,
} from '../../../lib/tauri/game-break-reminder';

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

let current: BreakReminderSettings = { intervalMinutes: 0, clockAlerts: [] };
let notify: (msg?: string) => void = () => {};

function renderInterval(settings: BreakReminderSettings) {
  const hours = byId<HTMLInputElement>('break-reminder-interval');
  // A box being typed in keeps its own value.
  if (hours && document.activeElement !== hours) hours.value = intervalHoursValue(settings.intervalMinutes);
}

function alertRow(alert: ClockAlert, index: number): HTMLLIElement {
  const t = getT().settings;
  const label = formatClockTime(alert.time, getLocaleCode());
  const item = document.createElement('li');
  item.className = 'clock-alerts-item';

  const time = document.createElement('span');
  time.className = 'clock-alerts-item-time';
  time.textContent = label;

  const weekdays = document.createElement('label');
  weekdays.className = 'clock-alerts-item-weekdays';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'settings-checkbox';
  checkbox.checked = alert.weekdaysOnly;
  checkbox.addEventListener('change', () => {
    const clockAlerts = current.clockAlerts.map((a, i) => (i === index ? { ...a, weekdaysOnly: checkbox.checked } : a));
    void save({ ...current, clockAlerts });
  });
  const weekdaysText = document.createElement('span');
  weekdaysText.textContent = t.clock_alerts_weekdays;
  weekdays.append(checkbox, weekdaysText);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'clock-alerts-item-remove';
  remove.textContent = '×';
  const removeLabel = interpolate(t.clock_alerts_remove, { time: label });
  remove.setAttribute('aria-label', removeLabel);
  remove.title = removeLabel;
  remove.addEventListener('click', () => {
    void save({ ...current, clockAlerts: current.clockAlerts.filter((_, i) => i !== index) });
  });

  item.append(time, weekdays, remove);
  return item;
}

function renderAlerts(settings: BreakReminderSettings) {
  const list = byId('clock-alerts-list');
  if (!list) return;
  list.replaceChildren(...settings.clockAlerts.map(alertRow));
  const full = settings.clockAlerts.length >= MAX_CLOCK_ALERTS;
  const empty = byId('clock-alerts-empty');
  if (empty) empty.hidden = settings.clockAlerts.length > 0;
  const limit = byId('clock-alerts-limit');
  if (limit) limit.hidden = !full;
  const add = byId<HTMLButtonElement>('clock-alerts-add');
  if (add) add.disabled = full;
  const preset = byId<HTMLButtonElement>('clock-alerts-preset');
  if (preset) {
    const time = preset.dataset.time ?? '';
    const label = formatClockTime(time, getLocaleCode());
    preset.textContent = `+ ${label}`;
    preset.setAttribute('aria-label', interpolate(getT().settings.clock_alerts_add_time, { time: label }));
    preset.removeAttribute('data-i18n-aria-label');
    preset.disabled = full || settings.clockAlerts.some(a => a.time === time);
  }
}

function render(settings: BreakReminderSettings) {
  current = settings;
  renderInterval(settings);
  renderAlerts(settings);
}

async function save(next: BreakReminderSettings) {
  try {
    render(await setBreakReminderSettings(next));
    notify();
  } catch (error) {
    notify(formatAppError(error, getT()));
    render(current);
  }
}

export function initBreakReminderSettings(showToast: (msg?: string) => void) {
  const panel = byId('break-reminder-settings');
  if (!panel || panel.dataset.initialized === 'true') return;
  panel.dataset.initialized = 'true';
  notify = showToast;

  render(current);
  void getBreakReminderSettings().then(render).catch(() => {});

  const hours = byId<HTMLInputElement>('break-reminder-interval');
  hours?.addEventListener('change', () => {
    // Unparseable text reads as "" in a number box; that must not mean "off".
    const minutes = hours.validity.badInput ? null : parseIntervalHours(hours.value);
    if (minutes === null) {
      hours.value = intervalHoursValue(current.intervalMinutes);
      return;
    }
    hours.value = intervalHoursValue(minutes);
    if (minutes !== current.intervalMinutes) void save({ ...current, intervalMinutes: minutes });
  });

  const time = byId<HTMLInputElement>('clock-alerts-time');
  const addTime = (raw: string) => {
    const clockAlerts = addClockAlert(current.clockAlerts, raw);
    if (clockAlerts !== current.clockAlerts) void save({ ...current, clockAlerts });
  };
  byId('clock-alerts-add')?.addEventListener('click', () => {
    if (!time?.value) {
      time?.focus();
      return;
    }
    addTime(time.value);
    time.value = '';
  });
  time?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && time.value) {
      event.preventDefault();
      addTime(time.value);
      time.value = '';
    }
  });
  const preset = byId<HTMLButtonElement>('clock-alerts-preset');
  preset?.addEventListener('click', () => addTime(preset.dataset.time ?? ''));
}
