// document.getElementById has no generic overload (unlike querySelector/closest),
// so every call site needing a specific element type had to redeclare its own
// `as HTMLXElement | null` cast. This centralizes that one cast.
export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
