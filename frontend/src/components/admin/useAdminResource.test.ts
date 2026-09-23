import { describe, it, expect } from 'vitest';
import { adminResourceReducer, initialAdminResourceState, type AdminResourceState } from './useAdminResource';

interface Row { id: string; name: string }
const key = (row: Row) => row.id;
const rows: Row[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
const reduce = (state: AdminResourceState<Row>, ...actions: Parameters<typeof adminResourceReducer<Row>>[1][]) =>
  actions.reduce((current, action) => adminResourceReducer(current, action, key), state);

describe('adminResourceReducer', () => {
  it('starts loading with nothing selected', () => {
    expect(initialAdminResourceState<Row>()).toEqual({
      items: [], loading: true, error: undefined, query: '', deleteTarget: null,
    });
  });

  it('load-start clears a previous error but keeps the current items on screen', () => {
    const state = reduce(initialAdminResourceState<Row>(), { type: 'load-failure', error: 'boom' }, { type: 'load-success', items: rows });
    const next = reduce({ ...state, error: 'stale' }, { type: 'load-start' });
    expect(next.loading).toBe(true);
    expect(next.error).toBeUndefined();
    expect(next.items).toBe(rows);
  });

  it('load-success replaces the items and stops loading', () => {
    const next = reduce(initialAdminResourceState<Row>(), { type: 'load-success', items: rows });
    expect(next).toMatchObject({ items: rows, loading: false, error: undefined });
  });

  it('load-failure empties the list and records the error', () => {
    const boom = new Error('boom');
    const next = reduce(initialAdminResourceState<Row>(), { type: 'load-success', items: rows }, { type: 'load-failure', error: boom });
    expect(next).toMatchObject({ items: [], loading: false, error: boom });
  });

  it('set-query only touches the query', () => {
    const loaded = reduce(initialAdminResourceState<Row>(), { type: 'load-success', items: rows });
    const next = reduce(loaded, { type: 'set-query', query: 'b' });
    expect(next).toEqual({ ...loaded, query: 'b' });
  });

  it('request-delete resolves the target by key, or null when unknown', () => {
    const loaded = reduce(initialAdminResourceState<Row>(), { type: 'load-success', items: rows });
    expect(reduce(loaded, { type: 'request-delete', key: 'b' }).deleteTarget).toBe(rows[1]);
    expect(reduce(loaded, { type: 'request-delete', key: 'b' }, { type: 'request-delete', key: 'zzz' }).deleteTarget).toBeNull();
  });

  it('set-delete-target accepts an item that is not in the list (synthetic targets)', () => {
    const synthetic = { id: 'c', name: 'C' };
    const next = reduce(initialAdminResourceState<Row>(), { type: 'set-delete-target', target: synthetic });
    expect(next.deleteTarget).toBe(synthetic);
    expect(reduce(next, { type: 'set-delete-target', target: null }).deleteTarget).toBeNull();
  });

  it('remove-item drops every row with that key and closes the confirm', () => {
    const loaded = reduce(
      initialAdminResourceState<Row>(),
      { type: 'load-success', items: [...rows, { id: 'a', name: 'A again' }] },
      { type: 'request-delete', key: 'a' },
    );
    const next = reduce(loaded, { type: 'remove-item', key: 'a' });
    expect(next.items).toEqual([rows[1]]);
    expect(next.deleteTarget).toBeNull();
  });

  it('remove-item for a key that is not present leaves the list alone', () => {
    const loaded = reduce(initialAdminResourceState<Row>(), { type: 'load-success', items: rows });
    expect(reduce(loaded, { type: 'remove-item', key: 'nope' }).items).toEqual(rows);
  });
});
