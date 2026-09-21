export interface ToastOptions {
  backgroundColor?: string;
  durationMs?: number;
  wide?: boolean;
  warningLabel?: string;
}

export type ToastLevel = 'error' | 'success';

/**
 * Shows a short-lived runtime notification without duplicating DOM/CSS setup
 * in every API or settings module.
 */
export function showToast(message: string, options: ToastOptions | ToastLevel = {}): void {
  if (typeof document === 'undefined') return;

  try {
    const resolvedOptions: ToastOptions = typeof options === 'string'
      ? { backgroundColor: options === 'error' ? '#ef4444' : '#10b981' }
      : options;
    const toast = document.createElement('div');
    toast.className = 'metadea-runtime-toast' + (resolvedOptions.wide ? ' metadea-runtime-toast--wide' : '');
    toast.style.setProperty('--toast-background', resolvedOptions.backgroundColor ?? '#ef4444');
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => toast.remove(), resolvedOptions.durationMs ?? 5000);
  } catch (error) {
    const warningLabel = typeof options === 'string' ? undefined : options.warningLabel;
    console.warn(warningLabel ?? 'Failed to show toast:', error);
  }
}
