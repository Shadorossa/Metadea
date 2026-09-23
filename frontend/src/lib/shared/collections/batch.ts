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
