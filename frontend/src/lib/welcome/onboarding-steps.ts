// The first-run onboarding flow (pages/welcome.astro): which steps exist, in
// what order, which ones the user may skip, and how a stored resume point maps
// back to a step. Pure, so the ordering and the resume rules are unit-tested.

import type { SettingsTabId } from './settings-tabs';

export const ONBOARDING_STEP_IDS = [
  'intro',
  'basics',
  'ui_theme',
  'profile',
  'library',
  'player',
  'local',
  'services',
  'emulators',
  'connections',
  'finish',
] as const;

export type OnboardingStepId = typeof ONBOARDING_STEP_IDS[number];

export type OnboardingIcon =
  | 'sparkles' | 'languages' | 'palette' | 'user' | 'library' | 'play'
  | 'folder' | 'key' | 'gamepad' | 'link' | 'flag';

export interface OnboardingStepDef {
  id: OnboardingStepId;
  icon: OnboardingIcon;
  /** Optional steps carry an "Optional" badge; nothing on them is required. */
  optional: boolean;
  /** Where the same controls live afterwards, for the "change it later" hint. */
  settingsTab?: SettingsTabId;
}

export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { id: 'intro', icon: 'sparkles', optional: false },
  { id: 'basics', icon: 'languages', optional: false, settingsTab: 'preferences' },
  { id: 'ui_theme', icon: 'palette', optional: true, settingsTab: 'plugins' },
  { id: 'profile', icon: 'user', optional: true, settingsTab: 'profile' },
  { id: 'library', icon: 'library', optional: false, settingsTab: 'preferences' },
  { id: 'player', icon: 'play', optional: true, settingsTab: 'preferences' },
  { id: 'local', icon: 'folder', optional: true, settingsTab: 'environment' },
  { id: 'services', icon: 'key', optional: true, settingsTab: 'environment' },
  { id: 'emulators', icon: 'gamepad', optional: true, settingsTab: 'emulators' },
  { id: 'connections', icon: 'link', optional: true, settingsTab: 'application' },
  { id: 'finish', icon: 'flag', optional: false },
];

/**
 * The flow before step ids were stored: `onboardingStep` held a bare index
 * into this nine-step order. Kept so a user who quit half-way through an
 * older build resumes on the same screen instead of an unrelated one.
 */
const LEGACY_STEP_ORDER: readonly OnboardingStepId[] = [
  'intro', 'basics', 'profile', 'library', 'local', 'services', 'emulators', 'connections', 'finish',
];

function isStepId(value: string): value is OnboardingStepId {
  return (ONBOARDING_STEP_IDS as readonly string[]).includes(value);
}

/** Index of the step to open, from the raw `onboardingStep` storage value. */
export function resolveStartStep(stored: string | null | undefined): number {
  if (!stored) return 0;
  const value = stored.trim();
  if (isStepId(value)) return ONBOARDING_STEP_IDS.indexOf(value);
  if (/^\d+$/.test(value)) {
    const legacy = LEGACY_STEP_ORDER[Number.parseInt(value, 10)];
    return legacy ? ONBOARDING_STEP_IDS.indexOf(legacy) : 0;
  }
  return 0;
}

/** Clamps a requested step index into the flow. */
export function clampStep(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), ONBOARDING_STEPS.length - 1);
}

/** Completion percentage shown by the progress bar (first step > 0 %). */
export function progressPercent(index: number): number {
  return Math.round(((clampStep(index) + 1) / ONBOARDING_STEPS.length) * 100);
}
