# Keyboard shortcuts — phase 2 wiring

**Status: DONE.** Every section below is wired; this file is kept as the map of where
each binding lives.

| Area | Where | Ids |
|---|---|---|
| Local grid | `components/local/LocalLibrary.tsx` (`page`) | `local.focus_search` (+ Escape clears the field) |
| Media page | `components/media/MediaPage.tsx` (`page`, gated by `noOverlayOpen`) | `media.open_editor`, `media.propose`, `media.copy_link`, `media.toggle_favorite`, `media.progress_increment/decrement`, `media.rate` (one binding, digits 1–9 and 0 = 10 via `lib/media/rating-digit.ts`), `media.play_theme` |
| PR editor | `components/media/PrEditorModal.tsx` (`modal`, `enabled: sessionActive`) | `pr_editor.submit`, `pr_editor.confirm`, `pr_editor.undo/redo`, `pr_editor.next_tab/prev_tab` |
| Media editor | `components/media/MediaEditorModal.tsx` (`modal`) | `media_editor.save`, `media_editor.confirm`, `media_editor.undo/redo`, `media_editor.next_tab/prev_tab` |
| Player | `lib/player/keymap.ts` `PLAYER_KEY_BINDINGS`, registered by `components/player/hooks/usePlayerKeys.ts` (`player`; Escape stays a private listener) | `player.*` — every existing key plus `ctrl+arrowleft/right`, `,`/`.`, `[`/`]`, `c`/`a`, `0-9`, `home`/`end` |

Undo/redo: `lib/shared/state/undo-history.ts` (bounded to 50, 500 ms coalescing of
text edits on one field) backs `prEditorReducer` (`undo`/`redo`) and `entryReducer`
(`UNDO`/`REDO`). New Rust commands: `player_frame_step(direction)`,
`player_cycle_track(kind)` (`src-tauri/src/player/commands.rs`, `permissions/player.toml`).

---

Phase 1 shipped the registry, the `?` sheet and the global/quick-search/library/search
bindings. This document is the exact wiring for the areas phase 1 could not touch
(other agents were editing them). Every i18n key listed below **already exists** in all
eight locales under the `shortcuts` namespace, so phase 2 only adds code.

## The API in one screen

```ts
// lib/shared/keyboard/shortcut-registry.ts  (pure, tested)
type ShortcutContext = 'global' | 'page' | 'modal' | 'player';   // ascending priority
interface ShortcutBinding {
  id: string;                          // stable, namespaced: 'media.open_editor'
  keys: string | readonly string[];    // 'mod+s', ['ctrl+arrowleft'], '+', '?', '0'
  description: string;                 // i18n key: 'shortcuts.media_open_editor'
  when?: () => boolean;                // false = does not fire AND does not shadow
  handler: (event: ShortcutEvent) => void;
  allowInInputs?: boolean;             // default false: ignored while an input/textarea/
}                                      // select/[contenteditable] has focus
registerShortcuts(context, bindings) => unregister
listActiveShortcuts() => ActiveShortcut[]        // what the "?" sheet shows

// components/shared/hooks/useShortcuts.ts  (React)
useShortcuts(context, bindings, { enabled?: boolean })
```

Rules the dispatcher already enforces (nothing to do in phase 2):

- `mod` = Ctrl on Windows/Linux, Meta on macOS.
- The highest-priority active context wins; `player` shadows `modal` shadows `page`
  shadows `global` for the same combo.
- `preventDefault()` is called whenever a binding handles the event.
- Handlers are read through a ref, so pass fresh closures every render — the hook only
  re-registers when an id/combo changes.
- `escape` is owned by `ModalShell` — never register it.

Key spelling: lowercase, `+`-joined. Arrows are `arrowleft`/`arrowright`/`arrowup`/
`arrowdown`; `home`, `end`, `enter`, `tab`, `space`. A bare `+` is the plus key
(`'+'`, `'mod++'`). Punctuation ignores Shift, so `'?'`, `'/'`, `'['`, `']'`, `','`,
`'.'`, `'+'`, `'-'` match on every layout.

---

## 1. Local grid — `mod+f` focuses its search input

| File | Hook call | Binding ids | i18n keys |
|---|---|---|---|
| `frontend/src/components/local/LocalLibrary.tsx` — the `<input type="text" className="local-tab-search">` bound to `filterName`/`setFilterName` (around line 550) | `useShortcuts('page', [...])` next to the component's other hooks | `local.focus_search` | `shortcuts.local_focus_search` |

```tsx
import { useShortcuts } from '../shared/hooks/useShortcuts';

const searchInputRef = useRef<HTMLInputElement>(null);   // attach to the grid's search input
useShortcuts('page', [{
  id: 'local.focus_search',
  keys: 'mod+f',
  description: 'shortcuts.local_focus_search',
  handler: () => { searchInputRef.current?.focus(); searchInputRef.current?.select(); },
}]);
```

Optional Escape-to-clear on that input (same pattern as `LibrarySection.tsx`):

```tsx
onKeyDown={e => {
  if (e.key !== 'Escape' || query.length === 0) return;
  e.preventDefault(); setQuery(''); e.currentTarget.blur();
}}
```

---

## 2. Media page

Register once in `frontend/src/components/media/MediaPage.tsx` (it already holds the
open-editor / propose / favourite / progress / rating callbacks it hands to `MediaHero`
and `MediaPageCards` under `components/media/media-page/`). Use the `page` context and
gate every binding with `when` on the data being loaded, so nothing fires while the page
is still fetching. Editors and players open on top and shadow these automatically
(`modal` / `player` contexts).

| File | Hook call | Binding id | keys | i18n key | Existing handler to call |
|---|---|---|---|---|---|
| `components/media/MediaPage.tsx` | `useShortcuts('page', bindings, { enabled: !!media })` | `media.open_editor` | `e` | `shortcuts.media_open_editor` | the "Editar" button's onClick |
| same | same | `media.propose` | `p` | `shortcuts.media_propose` | the "Proponer / PR" button's onClick |
| same | same | `media.copy_link` | `l` | `shortcuts.media_copy_link` | `lib/deep-link` copy-link action the header button uses |
| same | same | `media.toggle_favorite` | `f` | `shortcuts.media_toggle_favorite` | favourite toggle |
| same | same | `media.progress_increment` | `+` | `shortcuts.media_progress_increment` | progress +1 (the same call the `+` button makes) |
| same | same | `media.progress_decrement` | `-` | `shortcuts.media_progress_decrement` | progress −1 |
| same | same | `media.rate_1` … `media.rate_9`, `media.rate_10` | `1` … `9`, `0` | `shortcuts.media_rate` | set rating N (0 → 10). Map through the active rating system so 5-star/10-dec/3-emoji get a sensible value, or skip (`when`) for systems where a digit makes no sense |
| same | same | `media.play_theme` | `t` | `shortcuts.media_play_theme` | play the first entry of the themes list (`when: () => themes.length > 0`) |

```tsx
const ratingBindings = Array.from({ length: 10 }, (_, i) => {
  const digit = (i + 1) % 10;                 // 1..9, 0
  const value = i + 1;                        // 1..10
  return {
    id: `media.rate_${value}`,
    keys: String(digit),
    description: 'shortcuts.media_rate',
    when: () => canRateWithDigits,
    handler: () => setRating(value),
  };
});
useShortcuts('page', [
  { id: 'media.open_editor', keys: 'e', description: 'shortcuts.media_open_editor', when: () => canEdit, handler: openEditor },
  { id: 'media.propose', keys: 'p', description: 'shortcuts.media_propose', when: () => canPropose, handler: openProposal },
  { id: 'media.copy_link', keys: 'l', description: 'shortcuts.media_copy_link', handler: copyLink },
  { id: 'media.toggle_favorite', keys: 'f', description: 'shortcuts.media_toggle_favorite', when: () => inLibrary, handler: toggleFavorite },
  { id: 'media.progress_increment', keys: '+', description: 'shortcuts.media_progress_increment', when: () => inLibrary, handler: () => stepProgress(1) },
  { id: 'media.progress_decrement', keys: '-', description: 'shortcuts.media_progress_decrement', when: () => inLibrary, handler: () => stepProgress(-1) },
  ...ratingBindings,
  { id: 'media.play_theme', keys: 't', description: 'shortcuts.media_play_theme', when: () => themes.length > 0, handler: () => playTheme(themes[0]) },
], { enabled: !!media });
```

The sheet shows one row per binding; if ten rating rows are too noisy, register a
single binding with `keys: ['1','2','3','4','5','6','7','8','9','0']` and read
`event.key` inside the handler.

---

## 3. Editors (PR editor and media editor)

Both editors render inside `ModalShell`, so use the `modal` context. Every binding here
must set `allowInInputs: true` — the user is almost always typing in a field when they
press `mod+s`. Undo/redo go through the draft/baseline reducer, **not** the browser's
native text undo: only enable them when focus is not inside a text field (`when`),
otherwise the native behaviour in the field is the right one.

| File | Hook call | Binding id | keys | i18n key | Existing handler |
|---|---|---|---|---|---|
| `components/media/PrEditorModal.tsx` (the component with the submit button) | `useShortcuts('modal', bindings, { enabled: open })` | `pr_editor.submit` | `mod+s` | `shortcuts.editor_save` | the "Enviar propuesta" click (`when: () => canSubmit`) |
| same | same | `pr_editor.confirm` | `mod+enter` | `shortcuts.editor_confirm` | confirm the currently open confirmation step, if any (`when: () => confirmStepOpen`) |
| same | same | `pr_editor.undo` | `mod+z` | `shortcuts.editor_undo` | `dispatch({ type: 'undo' })` on the draft reducer (`components/media/pr-editor/pr-editor-state.ts` — `prEditorReducer` currently has `load`/`edit`/`reset`/`resync` only; add `undo`/`redo` there, see below); `when: () => canUndo && !isEditableTarget(document.activeElement)` |
| same | same | `pr_editor.redo` | `mod+y` (+ `mod+shift+z`) | `shortcuts.editor_redo` | `dispatch({ type: 'redo' })`; same `when` guard with `canRedo` |
| same | same | `pr_editor.next_tab` | `mod+tab` | `shortcuts.editor_next_tab` | the tab strip's "select next tab" (wrap around); `allowInInputs: true` |
| `components/media/MediaEditorModal.tsx` | `useShortcuts('modal', bindings, { enabled: open })` | `media_editor.save` | `mod+s` | `shortcuts.editor_save` | the editor's save/apply click |
| same | same | `media_editor.confirm` | `mod+enter` | `shortcuts.editor_confirm` | confirm step |
| same | same | `media_editor.undo` / `media_editor.redo` | `mod+z` / `mod+y` | `shortcuts.editor_undo` / `shortcuts.editor_redo` | reducer undo/redo, same guard |
| same | same | `media_editor.next_tab` | `mod+tab` | `shortcuts.editor_next_tab` | next section/tab |

Undo/redo in the reducer: keep `PrEditorState` as is and add `past: PrEditorDraft[]`
and `future: PrEditorDraft[]`; `edit` pushes the previous draft onto `past` and clears
`future`; `undo`/`redo` move one draft between the stacks; `load`/`reset`/`resync`
clear both. `canUndo = past.length > 0`, `canRedo = future.length > 0`. Unit-test it in
`pr-editor-state.test.ts` — the shortcut just dispatches. Same shape for the media
editor's state module under `components/media/media-editor/`.

`isEditableTarget` is exported from `lib/shared/keyboard/shortcut-registry.ts`.

Note on `mod+tab`: Chromium/WebView2 does not reserve Ctrl+Tab in an embedded webview,
and `preventDefault` is called by the dispatcher, so it is safe to bind.

---

## 4. Player additions

Today the player owns its keys in `components/player/hooks/usePlayerKeys.ts`: a private
window keydown listener that calls `resolvePlayerKeyAction` (`lib/player/keymap.ts`) and
then `runPlayerAction(action, context)` (`components/player/player-actions.ts`).

Recommended rewrite of `usePlayerKeys` (keeps `keymap.ts` and its tests untouched):

```ts
// components/player/hooks/usePlayerKeys.ts
export function usePlayerKeys(context: PlayerActionContext, enabled = true) {
  const latest = useRef(context);
  useEffect(() => { latest.current = context; });
  useShortcuts('player', PLAYER_BINDINGS.map(b => ({
    ...b,
    handler: () => runPlayerAction(b.action, latest.current),
  })), { enabled });
}
```

where `PLAYER_BINDINGS` is a static list `{ id, keys, description, action: PlayerKeyAction,
allowInInputs? }` covering the existing keys (space, arrows, shift+arrows, m, f, n/p,
j/k, q, F12 — `allowInInputs: true` only for Escape/F12/space, mirroring the current
guard) plus the new rows below. Extend the `PlayerKeyAction` union in `keymap.ts` with
`frame_step`, `speed_delta`, `cycle_track`, `seek_fraction`, `seek_start`, `seek_end`
and handle them in `runPlayerAction`. The `player` context outranks everything, so the
media page's `f`/`p`/digits never fire while the player is open.

New bindings:

| File | Hook call | Binding id | keys | i18n key | Engine call (`lib/player/engine` / mpv command) |
|---|---|---|---|---|---|
| `components/player/hooks/usePlayerKeys.ts` | `useShortcuts('player', bindings, { enabled })` | `player.prev_episode` | `ctrl+arrowleft` | `shortcuts.player_prev_episode` | same as the existing `prev` action |
| same | same | `player.next_episode` | `ctrl+arrowright` | `shortcuts.player_next_episode` | same as the existing `next` action |
| same | same | `player.frame_back` | `,` | `shortcuts.player_frame_back` | mpv `frame-back-step` (pauses) |
| same | same | `player.frame_forward` | `.` | `shortcuts.player_frame_forward` | mpv `frame-step` (pauses) |
| same | same | `player.speed_down` | `[` | `shortcuts.player_speed_down` | speed − 0.25 (clamp ≥ 0.25) — existing speed setter |
| same | same | `player.speed_up` | `]` | `shortcuts.player_speed_up` | speed + 0.25 (clamp ≤ 4) |
| same | same | `player.cycle_subtitles` | `c` | `shortcuts.player_cycle_subtitles` | mpv `cycle sub` |
| same | same | `player.cycle_audio` | `a` | `shortcuts.player_cycle_audio` | mpv `cycle audio` |
| same | same | `player.seek_percent` | `['0','1','2','3','4','5','6','7','8','9']` | `shortcuts.player_seek_percent` | seek to `Number(event.key) * 10 %` of duration (`seekTo(duration * n / 10)`) |
| same | same | `player.seek_start` | `home` | `shortcuts.player_seek_start` | `seekTo(0)` |
| same | same | `player.seek_end` | `end` | `shortcuts.player_seek_end` | `seekTo(duration)` (or `next` — pick one and keep it) |

The `player_*` commands need a generic mpv command bridge: if `lib/tauri/player.ts` has no
`playerCommand(args: string[])`, add a `player_command` Tauri command in
`src-tauri/src/player/commands.rs` that forwards to `mpv_command` (remember
`permissions/*.toml` — `acl_coverage.rs` fails otherwise), and expose
`frameStep(direction)`, `cycleTrack('sub' | 'audio')` on the engine wrapper.

Also update `player.shortcuts_hint` in every locale when these land (it is the
one-line legend shown in the player's overlay), or drop that string in favour of the
`?` sheet.

---

## 5. Checklist per file

1. `import { useShortcuts } from '<relative>/shared/hooks/useShortcuts';`
2. Build the bindings array in render (fresh closures are fine).
3. `useShortcuts('<context>', bindings, { enabled })`.
4. Use the i18n keys above — they exist already; do not add new ones unless a new
   action is introduced (then add to all eight `frontend/src/i18n/*.ts`, `es` first).
5. Press `?` in the app and confirm the new rows show under the right heading.
6. `cd frontend && npm run lint && npm run typecheck && npm run test`.
