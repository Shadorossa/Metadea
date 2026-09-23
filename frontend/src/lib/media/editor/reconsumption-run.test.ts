import { describe, it, expect } from 'vitest';
import {
  canStartReconsumptionRun, startReconsumptionRun, cancelReconsumptionRun, clampReconsumptionCount, reconsumeLabelKey,
} from './reconsumption-run';
import { createDefaultLog, createEmptyVersionEntry, libraryEntryToLog, entryReducer, entryInit } from './library-log-state';

describe('reconsumption run transitions', () => {
  it('only a completed work that is not already mid-run can start one', () => {
    expect(canStartReconsumptionRun({ status: 'completed', reconsuming: false })).toBe(true);
    expect(canStartReconsumptionRun({ status: 'completed', reconsuming: true })).toBe(false);
    expect(canStartReconsumptionRun({ status: 'watching', reconsuming: false })).toBe(false);
    expect(canStartReconsumptionRun({ status: '', reconsuming: false })).toBe(false);
  });

  it('starting a run resets progress and status but never touches the first-run dates', () => {
    const log = {
      ...createDefaultLog('completed'),
      progress: 12, progressCount2: 3, startedAt: '2020-01-01', finishedAt: '2020-02-01', reconsumptionCount: 1,
    };
    const state = { ...entryInit, activeLogId: 'anime:1', logs: { 'anime:1': log } };
    const next = entryReducer(state, { type: 'UPDATE_LOG', updates: startReconsumptionRun('watching') }).logs['anime:1'];
    expect(next).toMatchObject({
      reconsuming: true, status: 'watching', progress: 0, progressCount2: 0,
      startedAt: '2020-01-01', finishedAt: '2020-02-01', reconsumptionCount: 1,
    });
    expect(Object.keys(startReconsumptionRun('reading'))).not.toContain('startedAt');
    expect(Object.keys(startReconsumptionRun('reading'))).not.toContain('finishedAt');
  });

  it('cancelling a run restores completed + totals without counting it', () => {
    expect(cancelReconsumptionRun({ totalCount: 12, totalCount2: 3 })).toEqual({
      reconsuming: false, status: 'completed', progress: 12, progressCount2: 3,
    });
    // Unknown totals leave whatever progress the draft has.
    expect(cancelReconsumptionRun({ totalCount: null, totalCount2: 0 })).toEqual({
      reconsuming: false, status: 'completed',
    });
  });

  it('picks the label by the in-progress verb, falling back to "rewatch"', () => {
    expect(reconsumeLabelKey('reading')).toBe('reconsume_reading');
    expect(reconsumeLabelKey('playing')).toBe('reconsume_playing');
    expect(reconsumeLabelKey('watching')).toBe('reconsume_watching');
    expect(reconsumeLabelKey('')).toBe('reconsume_watching');
  });

  it('the stepper clamps to whole numbers >= 0', () => {
    expect(clampReconsumptionCount(-3)).toBe(0);
    expect(clampReconsumptionCount(2.7)).toBe(2);
    expect(clampReconsumptionCount(NaN)).toBe(0);
  });
});

describe('editor field mapping', () => {
  it('maps the saved row onto the draft and back to 0/false when absent', () => {
    const row = { ...createEmptyVersionEntry('anime:1', 'anime'), reconsumption_count: 2, reconsuming: 1 };
    expect(libraryEntryToLog(row)).toMatchObject({ reconsumptionCount: 2, reconsuming: true });

    const legacy = createEmptyVersionEntry('anime:2', 'anime');
    delete legacy.reconsumption_count;
    delete legacy.reconsuming;
    expect(libraryEntryToLog(legacy)).toMatchObject({ reconsumptionCount: 0, reconsuming: false });
    expect(createDefaultLog()).toMatchObject({ reconsumptionCount: 0, reconsuming: false });
  });
});
