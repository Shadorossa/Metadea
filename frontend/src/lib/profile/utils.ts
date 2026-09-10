import { getT } from '../../i18n/client';

export { pad } from '../shared/number-utils';
export { decodeJwtPayload } from '../shared/encoding-utils';
export { formatMonthLabel } from '../shared/formatDate';

export function typeLabel(t: string): string {
  const types = getT().search.types as Record<string, string>;
  return types[t] ?? t;
}
