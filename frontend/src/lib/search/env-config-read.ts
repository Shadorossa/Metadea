// The API-key config read every provider does before its first request.
// One "all types" search used to read it four times (IGDB twice, TMDB
// twice) over IPC, one round-trip each; here concurrent readers share a
// single in-flight read and a settled value is reused for a moment. The
// window is deliberately tiny — the settings page writes a new config
// through writeEnvConfig, and a search started right after must see it.
import { readEnvConfig, type EnvConfig } from '../tauri/env';

const REUSE_WINDOW_MS = 1_000;

let inFlight: Promise<EnvConfig> | null = null;
let settled: { value: EnvConfig; at: number } | null = null;

export function readSearchEnvConfig(): Promise<EnvConfig> {
  if (settled && Date.now() - settled.at < REUSE_WINDOW_MS) return Promise.resolve(settled.value);
  if (inFlight) return inFlight;
  inFlight = readEnvConfig().then(
    value => {
      settled = { value, at: Date.now() };
      inFlight = null;
      return value;
    },
    err => {
      inFlight = null;
      throw err;
    },
  );
  return inFlight;
}
