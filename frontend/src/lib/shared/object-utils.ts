// Assigns `value` to `target[key]` without an `any` cast. Plain
// `target[key] = value` inside a loop over a `keyof T` variable doesn't
// type-check on its own — TS can't confirm `value`'s type matches whichever
// property `key` happens to be at that point in the loop. Tying both to the
// same generic `K extends keyof T` gives the compiler that link back.
export function setField<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}
