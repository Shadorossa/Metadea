// One place for "fetch something per id, keep the id next to the result" —
// the same Promise.all(ids.map(async id => [id, await load(id)])) shape was
// written out by hand in five files. Callers decide how a failed load is
// represented (catch inside `load`), so a failure never drops an id.
export async function mapById<T>(
  ids: readonly string[],
  load: (id: string) => Promise<T>,
): Promise<Map<string, T>> {
  const entries = await Promise.all(ids.map(async id => [id, await load(id)] as const));
  return new Map(entries);
}

// The inverse of a batched "rows for these ids" read: one bucket per id, in
// `ids` order (every id present, empty when nothing matched), each keeping
// the rows' own relative order. Rows whose owner isn't one of `ids` are
// dropped, so a batch that returns edges touching either side (see
// getMediaRelationsForIds) still groups exactly like one per-id read each.
export function groupByOwner<T>(
  rows: readonly T[],
  ownerOf: (row: T) => string | undefined,
  ids: readonly string[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>(ids.map(id => [id, []]));
  for (const row of rows) {
    const owner = ownerOf(row);
    if (owner !== undefined) grouped.get(owner)?.push(row);
  }
  return grouped;
}
