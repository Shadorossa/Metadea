import type { en } from './en';

// en.ts (the reference locale) is written `as const`, so `typeof en` carries the exact English string
// literals. Constraining another locale to that type would demand it repeat
// the English text verbatim, which is why every locale used to be cast with
// `as unknown as Translations` — a cast that silently allowed missing keys,
// orphan keys and wrong shapes. Widening the leaves to `string` keeps the
// key structure checkable while letting each locale carry its own text.
type WidenLeaves<T> = T extends string ? string : { readonly [K in keyof T]: WidenLeaves<T[K]> };

export type Translations = WidenLeaves<typeof en>;
