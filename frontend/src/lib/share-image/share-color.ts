// Small colour math for the share image: parse the hex / rgb() values themes
// and tier labels use, and pick readable text on top of them.

export function parseRgb(color: string): [number, number, number] | null {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) return [0, 1, 2].map(i => parseInt(h[i] + h[i], 16)) as [number, number, number];
    if (h.length === 6 || h.length === 8) return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    return null;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** Alpha of a colour string, 1 when it carries none or is not parseable. */
export function colorAlpha(color: string): number {
  const value = color.trim().toLowerCase();
  if (value === 'transparent') return 0;
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    const h = hex[1];
    return parseInt(h.length === 4 ? h[3] + h[3] : h.slice(6, 8), 16) / 255;
  }
  const fn = /^(?:rgba?|hsla?)\((.*)\)$/.exec(value);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 4) {
      const a = parts[3];
      return a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a);
    }
  }
  return 1;
}

/** WCAG relative luminance, null when the colour is not parseable. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseRgb(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21), null when either colour is not parseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** '#111111' or '#ffffff', whichever contrasts more with `background`. */
export function contrastTextColor(background: string): string {
  const dark = contrastRatio(background, '#111111');
  const light = contrastRatio(background, '#ffffff');
  if (dark === null || light === null) return '#ffffff';
  return dark > light ? '#111111' : '#ffffff';
}
