import { getT } from '../../i18n/runtime';

export { pad } from '../shared/text/number-utils';
export { decodeJwtPayload } from '../shared/text/encoding-utils';
export { formatMonthLabel } from '../shared/text/format-date';

export function typeLabel(t: string): string {
  const types = getT().search.types as Record<string, string>;
  return types[t] ?? t;
}
