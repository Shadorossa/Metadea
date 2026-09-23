import { describe, it, expect } from 'vitest';
import { classifyDropZone, fillTemplate, resolveDrop, resolveSideDropIndex } from './sortable-list-logic';

describe('classifyDropZone', () => {
  it('uses the outer 22% bands and a middle group zone when grouping is allowed', () => {
    expect(classifyDropZone(0.1, true)).toBe('before');
    expect(classifyDropZone(0.219, true)).toBe('before');
    expect(classifyDropZone(0.22, true)).toBe('group');
    expect(classifyDropZone(0.5, true)).toBe('group');
    expect(classifyDropZone(0.78, true)).toBe('group');
    expect(classifyDropZone(0.781, true)).toBe('after');
    expect(classifyDropZone(0.95, true)).toBe('after');
  });

  it('splits the card in half when grouping is not allowed', () => {
    expect(classifyDropZone(0.3, false)).toBe('before');
    expect(classifyDropZone(0.5, false)).toBe('before');
    expect(classifyDropZone(0.51, false)).toBe('after');
    expect(classifyDropZone(0.7, false)).toBe('after');
  });
});

describe('resolveSideDropIndex', () => {
  // Reproduces "remove dragged, then splice before/after target" exactly.
  it('moving forward', () => {
    expect(resolveSideDropIndex(0, 2, 'before')).toBe(1);
    expect(resolveSideDropIndex(0, 2, 'after')).toBe(2);
  });

  it('moving backward', () => {
    expect(resolveSideDropIndex(2, 0, 'before')).toBe(0);
    expect(resolveSideDropIndex(2, 0, 'after')).toBe(1);
  });
});

describe('resolveDrop', () => {
  const base = { from: 0, target: 2, groupState: 'none' as const, canGroup: false, side: null };

  it('is a no-op without a distinct target', () => {
    expect(resolveDrop({ ...base, target: -1 })).toBeNull();
    expect(resolveDrop({ ...base, from: -1 })).toBeNull();
    expect(resolveDrop({ ...base, target: 0 })).toBeNull();
  });

  it('reorders onto the target index by default', () => {
    expect(resolveDrop(base)).toEqual({ kind: 'reorder', to: 2 });
  });

  it('groups only when armed and allowed', () => {
    expect(resolveDrop({ ...base, groupState: 'ready', canGroup: true })).toEqual({ kind: 'group', to: 2 });
    expect(resolveDrop({ ...base, groupState: 'ready', canGroup: false })).toEqual({ kind: 'reorder', to: 2 });
    expect(resolveDrop({ ...base, groupState: 'pending', canGroup: true })).toEqual({ kind: 'reorder', to: 2 });
  });

  it('honours before/after sides and drops moves that change nothing', () => {
    expect(resolveDrop({ ...base, from: 0, target: 1, side: 'before' })).toBeNull();
    expect(resolveDrop({ ...base, from: 0, target: 1, side: 'after' })).toEqual({ kind: 'reorder', to: 1 });
    expect(resolveDrop({ ...base, from: 3, target: 1, side: 'after' })).toEqual({ kind: 'reorder', to: 2 });
  });
});

describe('fillTemplate', () => {
  it('replaces every placeholder, including repeats', () => {
    expect(fillTemplate('{item} at {to} of {count} ({item})', { item: 'A', to: 2, count: 5 })).toBe('A at 2 of 5 (A)');
  });

  it('leaves unknown placeholders alone', () => {
    expect(fillTemplate('{item} {other}', { item: 'A' })).toBe('A {other}');
  });
});
