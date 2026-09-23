import { describe, it, expect, vi } from 'vitest';
import { closePlayerModal, openPlayerModal, playerModalStore } from './player-modal-state';

describe('playerModalStore', () => {
  it('starts closed and notifies only on actual transitions', () => {
    closePlayerModal();
    const listener = vi.fn();
    const unsubscribe = playerModalStore.subscribe(listener);
    expect(playerModalStore.get()).toBe(false);
    openPlayerModal();
    openPlayerModal();
    expect(playerModalStore.get()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    closePlayerModal();
    closePlayerModal();
    expect(playerModalStore.get()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
