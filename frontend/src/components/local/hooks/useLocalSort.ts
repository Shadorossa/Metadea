import { useState } from 'react';
import {
  defaultSortDirection,
  type SortDirection,
  type SortMode,
} from '../../../lib/local/catalog-game-linking';

export function useLocalSort() {
  const [sort, setSort] = useState<{ mode: SortMode; direction: SortDirection }>({
    mode: 'alpha',
    direction: defaultSortDirection('alpha'),
  });

  return {
    ...sort,
    changeMode: (mode: SortMode) => setSort({ mode, direction: defaultSortDirection(mode) }),
    toggleDirection: () => setSort(current => ({
      ...current,
      direction: current.direction === 'ascending' ? 'descending' : 'ascending',
    })),
  };
}
