import { useEffect, useMemo, useState } from 'react';
import type { MediaPageData } from '../../../lib/media/types';
import { getCatalogMalId } from '../../../lib/tauri/aniskip';
import { getPluginRuntime } from '../../../lib/plugins/runtime-instance';
import { buildWorkContext, type PluginWorkContext } from '../../../lib/plugins/work-context';
import { useExternalStore } from '../../shared/hooks/useExternalStore';

/**
 * The media page's work as plugins see it, and whether an enabled plugin
 * contributes a reading source for its type. `data` undefined (loading, or
 * the proposal preview) disables everything.
 */
export function usePluginWorkContext(data: MediaPageData | null | undefined): { work: PluginWorkContext | null; hasSources: boolean } {
  const runtime = getPluginRuntime();
  const installed = useExternalStore(runtime.plugins);
  const [malId, setMalId] = useState<{ id: string; malId: number | null } | null>(null);
  const externalId = data?.externalId;

  useEffect(() => {
    runtime.ensureLoaded().catch(() => {});
  }, [runtime]);

  useEffect(() => {
    if (!externalId) return;
    let alive = true;
    getCatalogMalId(externalId)
      .then(id => { if (alive) setMalId({ id: externalId, malId: id }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [externalId]);

  const work = useMemo(() => (data ? buildWorkContext({
    externalId: data.externalId,
    type: data.type,
    titleMain: data.titleMain,
    titleEnglish: data.titleEnglish,
    titleRomaji: data.titleRomaji,
    titleNative: data.titleNative,
    releaseYear: data.releaseYear,
    malId: malId?.id === data.externalId ? malId.malId : null,
  }) : null), [data, malId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the installed list changes
  const hasSources = useMemo(() => !!work && runtime.sourcesFor(work.type).length > 0, [runtime, installed, work]);
  return { work: installed.length > 0 ? work : null, hasSources };
}
