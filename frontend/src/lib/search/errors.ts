// Thrown by a search provider when the search couldn't run because its
// required API key(s) aren't configured yet (as opposed to a network/API
// failure) — lets the UI show a "go configure it" prompt instead of a
// generic error or a silent empty result set.
export class MissingApiKeyError extends Error {
  providers: string[];

  constructor(providers: string[]) {
    super(`Missing API key for: ${providers.join(', ')}`);
    this.name = 'MissingApiKeyError';
    this.providers = providers;
  }
}
