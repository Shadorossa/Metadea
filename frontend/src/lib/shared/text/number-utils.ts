// Common numeric formatting utilities previously scattered across modules.

// Zero-pad a number to 2-3 digits for timestamps/counts.
// pad(5) → "005", pad(42) → "042", pad(123) → "123"
export function pad(n: number): string {
  if (n < 10) return '00' + n;
  if (n < 100) return '0' + n;
  return String(n);
}
