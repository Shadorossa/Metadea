// Gradients used for fallback backgrounds by media type — shared by the Hall
// of Fame, several other string-rendered modules (lists, monthly, reviews,
// tier index), and the Recent Activity feed (formerly its own near-duplicate
// TYPE_GRADIENTS map in constants/media.ts, merged in here since both existed
// for the same purpose: a fallback cover background when there's no image).
export const HOF_GRADIENTS: Record<string, string> = {
  anime:  'linear-gradient(160deg, #4f46e5 0%, #7c3aed 100%)',
  manga:  'linear-gradient(160deg, #be185d 0%, #7c3aed 100%)',
  game:   'linear-gradient(160deg, #047857 0%, #1d4ed8 100%)',
  movie:  'linear-gradient(160deg, #b45309 0%, #dc2626 100%)',
  series: 'linear-gradient(160deg, #1d4ed8 0%, #0891b2 100%)',
  book:   'linear-gradient(160deg, #4d7c0f 0%, #0f766e 100%)',
  novel:  'linear-gradient(160deg, #c2410c 0%, #ca8a04 100%)',
  vnovel: 'linear-gradient(160deg, #a21caf 0%, #e11d48 100%)',
  lnovel: 'linear-gradient(160deg, #10b981 0%, #047857 100%)',
  comic:  'linear-gradient(160deg, #f97316 0%, #c2410c 100%)',
};
