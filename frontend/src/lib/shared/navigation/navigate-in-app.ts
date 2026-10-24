// Moves to another page of the app through Astro's ClientRouter, like a
// clicked <a>. `window.location.href = ...` reloads the whole document
// instead, and with it every module-level player (the jukebox's audio,
// the video and reading bars) stops. Falls back to a plain load if the
// router module cannot be fetched.
export function navigateInApp(href: string): void {
  import('astro:transitions/client')
    .then(({ navigate }) => navigate(href))
    .catch(() => { window.location.href = href; });
}
