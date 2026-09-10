// Common numeric formatting utilities previously scattered across modules.

// Zero-pad a number to 2-3 digits for timestamps/counts.
// pad(5) → "005", pad(42) → "042", pad(123) → "123"
export function pad(n: number): string {
  if (n < 10) return '00' + n;
  if (n < 100) return '0' + n;
  return String(n);
}

// Clamp a number between min and max (inclusive).
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Format bytes as human-readable "KB", "MB", etc.
// Already exists in formatters.ts but centralized here for reuse.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
