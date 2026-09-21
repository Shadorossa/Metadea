export interface ToastOptions {
  backgroundColor?: string;
  durationMs?: number;
  wide?: boolean;
  warningLabel?: string;
}

/**
 * Shows a short-lived runtime notification without duplicating DOM/CSS setup
 * in every API or settings module.
 */
export function showToast(message: string, options: ToastOptions = {}): void {
  if (typeof document === 'undefined') return;

  try {
    const toast = document.createElement('div');
    toast.className = 'metadea-runtime-toast' + (options.wide ? ' metadea-runtime-toast--wide' : '');
    toast.style.setProperty('--toast-background', options.backgroundColor ?? '#ef4444');
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => toast.remove(), options.durationMs ?? 5000);
  } catch (error) {
    console.warn(options.warningLabel ?? 'Failed to show toast:', error);
  }
}
