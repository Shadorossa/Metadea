// Shared es-ES date formatting presets, replacing five near-identical
// toLocaleDateString('es-ES', {...}) call sites that had each drifted to
// slightly different option shapes for the same handful of layouts.

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateNumeric(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

export function formatUnixTimestampShort(unixSeconds?: number): string | null {
  if (!unixSeconds) return null;
  return formatDateShort(new Date(unixSeconds * 1000));
}
