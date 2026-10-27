import { describe, it, expect } from 'vitest';
import { FOCUSABLE_SELECTOR, createModalStack, getFocusable, resolveTabTarget } from './ModalShell';

interface FakeEl {
  name: string;
  disabled?: boolean;
  getClientRects?(): ArrayLike<unknown>;
}

function el(name: string, overrides: Partial<FakeEl> = {}): FakeEl {
  return { name, ...overrides };
}

function root(...children: FakeEl[]) {
  return {
    querySelectorAll(selectors: string): ArrayLike<FakeEl> {
      expect(selectors).toBe(FOCUSABLE_SELECTOR);
      return children;
    },
  };
}

describe('getFocusable', () => {
  it('keeps DOM order and drops disabled or unrendered elements', () => {
    const a = el('a');
    const b = el('b', { disabled: true });
    const c = el('c', { getClientRects: () => [] });
    const d = el('d', { getClientRects: () => [{}] });
    expect(getFocusable(root(a, b, c, d))).toEqual([a, d]);
  });

  it('honours a custom visibility predicate', () => {
    const a = el('a');
    const b = el('b');
    expect(getFocusable(root(a, b), candidate => candidate === b)).toEqual([b]);
  });

  it('returns an empty list when nothing is focusable', () => {
    expect(getFocusable(root())).toEqual([]);
  });
});

describe('resolveTabTarget', () => {
  const first = el('first');
  const middle = el('middle');
  const last = el('last');
  const outside = el('outside');
  const unlisted = el('tabindex-minus-one');
  const cycle = [first, middle, last];

  it.each<[string, FakeEl[], FakeEl | null, boolean, boolean, FakeEl | null]>([
    ['wraps from the last element to the first on Tab', cycle, last, false, false, first],
    ['wraps from the first element to the last on Shift+Tab', cycle, first, true, false, last],
    // Strictly inside the cycle the browser default is left alone.
    ['inside: middle, Tab', cycle, middle, false, false, null],
    ['inside: middle, Shift+Tab', cycle, middle, true, false, null],
    ['inside: first, Tab', cycle, first, false, false, null],
    ['inside: last, Shift+Tab', cycle, last, true, false, null],
    // Focus outside the panel or on the panel itself re-enters the cycle.
    ['re-enters from outside on Tab', cycle, outside, false, false, first],
    ['re-enters from outside on Shift+Tab', cycle, outside, true, false, last],
    ['re-enters from the panel on Tab', cycle, null, false, false, first],
    ['re-enters from the panel on Shift+Tab', cycle, null, true, false, last],
    // An unlisted element inside the panel keeps the default move.
    ['unlisted inside the panel, Tab', cycle, unlisted, false, true, null],
    ['unlisted inside the panel, Shift+Tab', cycle, unlisted, true, true, null],
    ['returns null for an empty cycle so the caller can focus the panel', [], null, false, false, null],
    ['cycles a single element onto itself on Tab', [first], first, false, false, first],
    ['cycles a single element onto itself on Shift+Tab', [first], first, true, false, first],
  ])('%s', (_name, list, active, shift, inPanel, expected) => {
    expect(resolveTabTarget(list, active, shift, inPanel)).toBe(expected);
  });
});

describe('createModalStack', () => {
  it('reports only the most recently pushed token as top', () => {
    const stack = createModalStack<object>();
    const editor = {};
    const popup = {};
    expect(stack.size).toBe(0);
    expect(stack.isTop(editor)).toBe(false);

    stack.push(editor);
    expect(stack.isTop(editor)).toBe(true);

    stack.push(popup);
    expect(stack.size).toBe(2);
    expect(stack.isTop(popup)).toBe(true);
    expect(stack.isTop(editor)).toBe(false);

    stack.remove(popup);
    expect(stack.isTop(editor)).toBe(true);
    expect(stack.size).toBe(1);
  });

  it('tolerates out-of-order removal and re-pushing an existing token', () => {
    // Out-of-order removal is a backgrounded session tab leaving the stack
    // while a popup above it stays on top.
    const stack = createModalStack<object>();
    const a = {};
    const b = {};
    const c = {};
    stack.push(a);
    stack.push(b);
    stack.push(c);

    stack.remove(a);
    expect(stack.size).toBe(2);
    expect(stack.isTop(c)).toBe(true);

    stack.push(b);
    expect(stack.size).toBe(2);
    expect(stack.isTop(b)).toBe(true);

    stack.remove(a);
    expect(stack.size).toBe(2);

    stack.remove(b);
    stack.remove(c);
    expect(stack.size).toBe(0);
    expect(stack.isTop(c)).toBe(false);
  });
});
