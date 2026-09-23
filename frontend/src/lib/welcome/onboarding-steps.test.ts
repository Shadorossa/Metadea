import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS, ONBOARDING_STEP_IDS, clampStep, progressPercent, resolveStartStep,
} from './onboarding-steps';

describe('ONBOARDING_STEPS', () => {
  it('follows ONBOARDING_STEP_IDS one to one, in order', () => {
    expect(ONBOARDING_STEPS.map(step => step.id)).toEqual([...ONBOARDING_STEP_IDS]);
  });

  it('starts with the intro and ends with the finish screen, neither optional', () => {
    expect(ONBOARDING_STEPS[0]).toMatchObject({ id: 'intro', optional: false });
    expect(ONBOARDING_STEPS.at(-1)).toMatchObject({ id: 'finish', optional: false });
  });
});

describe('resolveStartStep', () => {
  it('opens the first step when nothing is stored', () => {
    expect(resolveStartStep(null)).toBe(0);
    expect(resolveStartStep(undefined)).toBe(0);
    expect(resolveStartStep('')).toBe(0);
  });

  it('resumes on a stored step id', () => {
    expect(resolveStartStep('player')).toBe(ONBOARDING_STEP_IDS.indexOf('player'));
    expect(resolveStartStep(' finish ')).toBe(ONBOARDING_STEP_IDS.length - 1);
  });

  it('maps a legacy numeric index from the nine-step flow to the same screen', () => {
    // Old order: intro, basics, profile, preferences, local, api, emulators, connections, finish.
    expect(resolveStartStep('2')).toBe(ONBOARDING_STEP_IDS.indexOf('profile'));
    expect(resolveStartStep('3')).toBe(ONBOARDING_STEP_IDS.indexOf('library'));
    expect(resolveStartStep('5')).toBe(ONBOARDING_STEP_IDS.indexOf('services'));
    expect(resolveStartStep('8')).toBe(ONBOARDING_STEP_IDS.indexOf('finish'));
  });

  it('falls back to the first step for unknown values', () => {
    expect(resolveStartStep('42')).toBe(0);
    expect(resolveStartStep('-1')).toBe(0);
    expect(resolveStartStep('not-a-step')).toBe(0);
  });
});

describe('clampStep / progressPercent', () => {
  it('keeps the index inside the flow', () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(2.7)).toBe(2);
    expect(clampStep(999)).toBe(ONBOARDING_STEPS.length - 1);
    expect(clampStep(Number.NaN)).toBe(0);
  });

  it('shows some progress on the first step and 100 % on the last', () => {
    expect(progressPercent(0)).toBeGreaterThan(0);
    expect(progressPercent(ONBOARDING_STEPS.length - 1)).toBe(100);
  });
});
