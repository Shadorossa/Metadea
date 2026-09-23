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
  const cycle = [first, middle, last];

  it('wraps from the last element to the first on Tab', () => {
    expect(resolveTabTarget(cycle, last, false)).toBe(first);
  });

  it('wraps from the first element to the last on Shift+Tab', () => {
    expect(resolveTabTarget(cycle, first, true)).toBe(last);
  });

  it('leaves the browser default alone strictly inside the cycle', () => {
    expect(resolveTabTarget(cycle, middle, false)).toBeNull();
    expect(resolveTabTarget(cycle, middle, true)).toBeNull();
    expect(resolveTabTarget(cycle, first, false)).toBeNull();
    expect(resolveTabTarget(cycle, last, true)).toBeNull();
  });

  it('re-enters the cycle when focus is outside the panel or on the panel itself', () => {
    const outside = el('outside');
    expect(resolveTabTarget(cycle, outside, false)).toBe(first);
    expect(resolveTabTarget(cycle, outside, true)).toBe(last);
    expect(resolveTabTarget(cycle, null, false)).toBe(first);
    expect(resolveTabTarget(cycle, null, true)).toBe(last);
  });

  it('keeps the default move for an unlisted element inside the panel', () => {
    const unlisted = el('tabindex-minus-one');
    expect(resolveTabTarget(cycle, unlisted, false, true)).toBeNull();
    expect(resolveTabTarget(cycle, unlisted, true, true)).toBeNull();
  });

  it('returns null for an empty cycle so the caller can focus the panel', () => {
    expect(resolveTabTarget([], null, false)).toBeNull();
  });

  it('cycles a single element onto itself', () => {
    expect(resolveTabTarget([first], first, false)).toBe(first);
    expect(resolveTabTarget([first], first, true)).toBe(first);
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

  it('hands Escape/trap down one level at a time as nested modals close', () => {
    // PrEditorModal -> MediaSearchPopup -> ImageCropModal (own React root).
    const stack = createModalStack<object>();
    const editor = {};
    const popup = {};
    const cropper = {};
    stack.push(editor);
    stack.push(popup);
    stack.push(cropper);
    expect([editor, popup, cropper].map(token => stack.isTop(token))).toEqual([false, false, true]);

    stack.remove(cropper);
    expect([editor, popup].map(token => stack.isTop(token))).toEqual([false, true]);

    stack.remove(popup);
    expect(stack.isTop(editor)).toBe(true);
  });

  it('lets a backgrounded session tab leave the stack without disturbing what is above it', () => {
    // Two session editors: A goes display:none (inactive) while a popup
    // opened from B is still up — the popup must stay on top.
    const stack = createModalStack<object>();
    const editorA = {};
    const editorB = {};
    const popup = {};
    stack.push(editorA);
    stack.push(editorB);
    stack.push(popup);

    stack.remove(editorA);
    expect(stack.isTop(popup)).toBe(true);
    expect(stack.size).toBe(2);

    stack.remove(popup);
    expect(stack.isTop(editorB)).toBe(true);

    stack.push(editorA);
    expect(stack.isTop(editorA)).toBe(true);
    expect(stack.isTop(editorB)).toBe(false);
  });

  it('tolerates out-of-order removal and re-pushing an existing token', () => {
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
