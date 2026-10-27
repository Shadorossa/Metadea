import { beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryEntry } from '../../../tests/support/library-entry';

const mocks = vi.hoisted(() => ({
  getMediaRelations: vi.fn(),
  getCatalogEntry: vi.fn(),
  invoke: vi.fn(),
  tauriCmd: vi.fn(),
}));

vi.mock('./catalog', () => ({ getMediaRelations: mocks.getMediaRelations, getCatalogEntry: mocks.getCatalogEntry }));
vi.mock('./bridge', () => ({
  invoke: mocks.invoke,
  tauriCmd: mocks.tauriCmd,
  tauriRun: vi.fn(),
  isTauri: () => true,
  readStoredJson: vi.fn(),
  writeStoredJson: vi.fn(),
}));

const { addSequelToPlanning } = await import('./library');

const SEQUEL = { media_external_id: 'anime:1', related_media_external_id: 'anime:2', relation_type: 'SEQUEL', type_label: 'Sequel' };

describe('addSequelToPlanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMediaRelations.mockResolvedValue([SEQUEL]);
    mocks.getCatalogEntry.mockResolvedValue({ external_id: 'anime:2', type: 'anime' });
    mocks.invoke.mockImplementation(async (_cmd: string, args: { entry: unknown }) => args.entry);
  });

  it('adds an untracked sequel as planning', async () => {
    mocks.tauriCmd.mockResolvedValue(null);
    expect(await addSequelToPlanning('anime:1')).toBe('anime:2');
    expect(mocks.invoke).toHaveBeenCalledWith('save_library_entry', {
      entry: expect.objectContaining({ external_id: 'anime:2', status: 'planning', type: 'anime' }),
    });
  });

  it('never touches an existing entry, even one without a status', async () => {
    mocks.tauriCmd.mockResolvedValue(libraryEntry({ external_id: 'anime:2', status: null, rating: 8, is_favorite: 1 }));
    expect(await addSequelToPlanning('anime:1')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does nothing when the existing entry could not be read', async () => {
    mocks.tauriCmd.mockRejectedValue(new Error('ipc'));
    expect(await addSequelToPlanning('anime:1')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
