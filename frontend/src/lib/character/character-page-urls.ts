// URL scheme allow-list for src/href attributes rendered by the character
// page island. Same policy as safeUrl (lib/shared/text/sanitize-html) —
// http(s), the app's asset:// protocol and image data URIs — but without
// the HTML entity escaping, which JSX already does for attribute values
// (and which would otherwise corrupt `&` in query strings).
const ALLOWED_URL_RE = /^(https?:|asset:|data:image\/(?:png|jpe?g|webp|gif|svg\+xml|avif);base64,)/i;

export function attributeUrl(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  return ALLOWED_URL_RE.test(trimmed) ? trimmed : '';
}
