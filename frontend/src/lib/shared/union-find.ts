export interface UnionFind<T> {
  has(value: T): boolean;
  find(value: T): T;
  union(a: T, b: T): void;
}

/** Small disjoint-set implementation for catalog relationship components. */
export function createUnionFind<T>(): UnionFind<T> {
  const parent = new Map<T, T>();
  const rank = new Map<T, number>();

  const add = (value: T) => {
    if (!parent.has(value)) {
      parent.set(value, value);
      rank.set(value, 0);
    }
  };

  const find = (value: T): T => {
    add(value);
    const currentParent = parent.get(value)!;
    if (currentParent !== value) {
      const root = find(currentParent);
      parent.set(value, root);
      return root;
    }
    return value;
  };

  return {
    has: value => parent.has(value),
    find,
    union: (a, b) => {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA === rootB) return;

      const rankA = rank.get(rootA) ?? 0;
      const rankB = rank.get(rootB) ?? 0;
      if (rankA < rankB) {
        parent.set(rootA, rootB);
      } else if (rankA > rankB) {
        parent.set(rootB, rootA);
      } else {
        parent.set(rootB, rootA);
        rank.set(rootA, rankA + 1);
      }
    },
  };
}
