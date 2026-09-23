# Frozen quirks: decisions needed

The v0.5.5 refactor added characterization tests that lock in behaviour which looks
like a bug rather than fixing it. Each is marked in the test with a comment
(`Characterization:`, `Suspected bug:`, `Documented:`) or an `it()` title that spells
out the surprise. This file lists them so the owner can decide: **Fix**, **Keep**
(and reword the test as documented behaviour), or **Product decision**.

Paths are relative to the repo root; `frontend/src` is abbreviated `src`.
Effort: S = under an hour, M = half a day, L = touches several modules or data.

## Summary table

| # | Area | Quirk | Rec. | Effort |
|---|------|-------|------|--------|
| 1 | Editor/proposals | Branch relation removal counted as update but never highlighted | Fix | S |
| 2 | Editor/proposals | Blanked proposal field falls back to provider, skipping local | Product | S |
| 3 | Editor/proposals | Alias union is case-sensitive; provider aliases first | Fix | S |
| 4 | Editor/proposals | Null proposed relation_type overwrites provider (actors do not) | Fix | S |
| 5 | Editor/proposals | New entry with explicit `blocked_at: null` reads as "Unblocked" | Fixed | S |
| 6 | Editor/proposals | Relation type change shows empty "before" when not in original map | Fix | S |
| 7 | Editor/proposals | Session merge unions relations only; characters/authors owner-only | Product | M |
| 8 | Editor/proposals | Session merge never filters removed arc ids against surviving arcs | Fix | S |
| 9 | Editor/proposals | Character merge replaces the `character` object wholesale | Product | S |
| 10 | Library grouping | Edge to an id outside the saga discards the whole topo order | Fixed | S |
| 11 | Library grouping | In-group positions ignored when no SEQUEL/PREQUEL edge exists | Fix | S |
| 12 | Library grouping | Lone grouped story-arc item keeps a stale group id | Keep | S |
| 13 | Library grouping | `max(episode_number, offset)` guesses "already global" numbering | Product | M |
| 14 | Library grouping | Theme episode range shifted only when first number <= offset | Product | S |
| 15 | Media page | AniList `total_count` refreshed only on manual retry | Product | S |
| 16 | Media page | Legacy `getPreferredCover` call shape hits localStorage per call | Keep | S |
| 17 | Local files | "Director's Cut" never matches the edition keyword | Fixed | S |
| 18 | Local files | Episode marker `E` eats the trailing "e" of the title ("One Pie") | Fixed | S |
| 19 | Local files | "Vol. 3" / "Ch. 12" (dot + space) not recognised as markers | Fix | S |
| 20 | Local files | Season-conflict penalty never rejects a folder | Product | S |
| 21 | Local files | File match only checks filename-contains-title, never reverse | Keep | S |
| 22 | Local files | Rename plan silently drops files past the known episode count | Product | M |
| 23 | Local files | One-word game titles never prefix-match an edition | Keep | S |
| 24 | Character page | "Blood Type" biography line duplicates AniList's structured field | Fixed | S |
| 25 | i18n | Locales are cast from `es`; missing keys silently render Spanish | Keep | M |
| 26 | Rust | Screenshot label needs no word boundary before `S` ("Bus1e2") | Fix | S |
| 27 | Rust | Overflowing season number aborts instead of trying later markers | Fix | S |

## Editor / proposals

### 1. Branch relation removal counted as update, never highlighted
- Test: `src/lib/github/proposal-diff.test.ts:199` — Code: `src/lib/github/proposal-diff.ts:189`
- Now: when a branch relation is removed and the provider still has it under another type, `counts.updated` is bumped but the id is not pushed to `updatedIds`.
- Wrong because: the summary says "1 updated" yet nothing on the page is marked; the user cannot find what changed.
- Intended: push the id to `updatedIds` (or count it as removed).
- Risk: highlight logic in the proposal preview; low.
- Decision: Fix. Effort S.

### 2. Blanked proposal field skips the local value
- Test: `proposal-diff.test.ts:351` — Code: `proposal-diff.ts:371`
- Now: `proposal.name = ''` resolves to the provider value; the local edit is ignored entirely.
- Wrong because: a contributor who clears a field sees provider data instead of either the cleared field or the local value; asymmetric with untouched fields (local, then provider).
- Intended: either honour the blank (clear) or fall back local then provider.
- Risk: preview only; the persisted proposal is not affected.
- Decision: Product decision (what does "blank" mean in a proposal?). Effort S.

### 3. Alias union is case-sensitive and provider-first
- Test: `proposal-diff.test.ts:373` — Code: `proposal-diff.ts:377`
- Now: `Mark Evans` and `mark evans` both survive; provider aliases are listed before the proposed ones.
- Wrong because: `normalizeAliases` (line 290) already lower-cases for comparison, so the preview shows duplicates that the diff itself treats as equal.
- Intended: dedupe case-insensitively, keep the proposal's order first.
- Risk: none beyond the preview string.
- Decision: Fix. Effort S.

### 4. Null relation_type overwrites the provider appearance
- Test: `proposal-diff.test.ts:417` — Code: `proposal-diff.ts:410` (vs actors at `:421`)
- Now: `{ relation_type: null }` in the proposal clobbers the provider's `MAIN`; actors skip null/undefined fields.
- Wrong because: two merge helpers next to each other disagree on what null means.
- Intended: same null-skipping rule as actors.
- Risk: a proposal that deliberately clears a role would no longer be able to; check whether the editor ever emits null here.
- Decision: Fix (align with actors). Effort S.

### 5. New entry with explicit `blocked_at: null` reads as "Unblocked"
- Test: `src/components/media/pr-editor/pr-editor-change-summary.test.ts:44` — Code: `src/components/media/pr-editor/pr-editor-change-summary.ts:73`
- Now: `null !== undefined`, so a brand-new entry whose draft carries `blocked_at: null` emits "- Unblocked (restored to Metadea)" in the PR body.
- Wrong because: nothing was ever blocked; PR reviewers see a misleading line.
- Intended: compare with `(a ?? null) !== (b ?? null)`.
- Risk: none.
- Decision: Fixed (`(a ?? null) !== (b ?? null)`). Effort S.

### 6. Empty "before" type for a relation not in the original map
- Test: `pr-editor-change-summary.test.ts:124` — Code: `pr-editor-change-summary.ts:104`
- Now: prints `anime:2 ( → SPIN_OFF)`.
- Wrong because: a change with no before value should be an "Added Relation" line, or at least show a placeholder.
- Intended: fall back to "Added Relation" or print `(none)`.
- Risk: PR body wording only.
- Decision: Fix. Effort S.

### 7. Session merge unions relations only
- Test: `src/components/media/media-page/proposal-session-merge.test.ts:94` — Code: `src/components/media/media-page/proposal-session-merge.ts:41-44`
- Now: when two batches touch the same media entry, relations are unioned, but characters and authors come wholesale from the owner draft; removed character/author ids are filtered only against the owner list.
- Wrong because: a side-effect batch that added a character to this entry loses it silently; a removal that still names a side-effect character is kept even though the character is gone.
- Intended: union characters/authors by external id the same way relations are.
- Risk: the character branch (line 60 on) already unions appearances/actors, so the pattern exists; verify bundle size and duplicate handling.
- Decision: Product decision (is "owner wins wholesale" deliberate for characters?). Effort M.

### 8. Removed arc ids never filtered
- Test: `proposal-session-merge.test.ts:114` — Code: `proposal-session-merge.ts:45`
- Now: `removedArcIds` is a plain union; `arc-1` stays in the removed list even though the owner draft still has that arc.
- Wrong because: `removedRelationIds` on the previous line does filter against surviving relations; an arc can be both saved and deleted in the same proposal.
- Intended: filter against `ownerEntry.bundle.story_arcs`.
- Risk: none; one-line change.
- Decision: Fix. Effort S.

### 9. Character object replaced wholesale
- Test: `proposal-session-merge.test.ts:186` — Code: `proposal-session-merge.ts:56` (spread of `ownerEntry.bundle`)
- Now: the owner's `character` object replaces the other batch's; `media_catalog` in the media branch is merged per field (line 33).
- Wrong because: a side-effect edit to the biography is lost if the owner draft only set the name.
- Intended: `{ ...other.character, ...owner.character }`.
- Risk: none obvious.
- Decision: Product decision (same question as #7). Effort S.

## Library grouping (saga / story arcs)

### 10. Edge outside the id list discards the topo order
- Test: `src/lib/media/saga/saga-grouping.test.ts:92` — Code: `src/lib/media/saga/saga-grouping.ts:112`
- Now: an edge pointing at an id not in `ids` makes `result.length !== ids.length`, so the whole sort falls back to release-date order.
- Wrong because: one stray edge (a member removed from the saga, a blocked entry) reverts a manual reorder for every other member.
- Intended: ignore edges whose target is not in `ids` before building in-degrees (`reconstructSagaOrder` already does this at its own level, so only direct callers of `topoSortByPrecedes` are exposed).
- Risk: low; other callers of `topoSortByPrecedes` should be checked.
- Decision: Fixed (edges with either end outside `ids` are skipped). Effort S.

### 11. In-group positions ignored without chronological edges
- Test: `saga-grouping.test.ts:137` — Code: `saga-grouping.ts:92` (early return on empty `precedes`)
- Now: alternates saved with "#1/#2" positions keep release-date order unless at least one SEQUEL/PREQUEL edge exists.
- Wrong because: a saga made only of alternates cannot be reordered persistently.
- Intended: apply the tie-break sort even when there are no edges.
- Risk: sagas with no edges currently rely on date order; the tie-break would only reorder those with explicit positions.
- Decision: Fix. Effort S.

### 12. Lone grouped item keeps its stale group id
- Test: `src/lib/media/editor/story-arc-units.test.ts:50` — Code: `src/lib/media/editor/story-arc-units.ts:70`
- Now: a single item with a `group_id` becomes a unit with `isGroup: false` but `id`/`groupId` set to the group id.
- Wrong because: a group of one is a leftover from ungrouping the others; the id persists into the saved arc.
- Intended: treat it as a plain unit (`groupId: null`) or clean the group id on save.
- Risk: drag/drop keys use `unit.id`; changing it mid-session could break reorder. Cosmetic otherwise.
- Decision: Keep (document), clean up on save if convenient. Effort S.

### 13. "Already global" episode numbering heuristic
- Test: `story-arc-units.test.ts:76` — Code: `story-arc-units.ts:106`
- Now: `generalEpNumber = max(round(episode_number), offset + i + 1)`; a second season numbered 10, 11 is assumed to be global numbering.
- Wrong because: a season whose local numbering happens to exceed the running offset (a long season 1 followed by a short one starting at 13) gets misnumbered; behaviour changes silently depending on provider numbering.
- Intended: an explicit per-work flag (or provider hint) for "numbered continuously".
- Risk: story-arc episode pickers and saved ranges depend on these numbers.
- Decision: Product decision. Effort M.

### 14. Theme episode range shifted only when first number <= offset
- Test: `src/components/media/media-page/media-page-format.test.ts:44` — Code: `src/components/media/media-page/media-page-format.tsx:29`
- Now: `"25-37"` with offset 24 is left alone, `"24-30"` is shifted to `48-54`.
- Wrong because: the boundary is a guess; a season whose OP genuinely covers episodes 25-37 (relative) is displayed as absolute 25-37, and `24-30` next to it is doubled.
- Intended: same as #13; know whether the provider's numbers are relative.
- Risk: display only.
- Decision: Product decision. Effort S.

## Media page and persistence

### 15. AniList `total_count` only refreshed on manual retry
- Test: `src/lib/media/media-page-persist.test.ts:144` — Code: `src/lib/media/media-page-persist.ts:77`
- Now: on a normal page visit the stored total keeps its old value; only the explicit retry path writes the new provider count.
- Wrong because: an airing show keeps a stale episode total until the user notices and retries; progress bars use this count.
- Intended: refresh when the provider count is larger (or when the stored value is null).
- Risk: local overrides to `total_count` (manually curated) would be overwritten; that is presumably why the guard exists.
- Decision: Product decision (add "curated" flag vs always refresh). Effort S.

### 16. Legacy `getPreferredCover` call shape reads storage every call
- Test: `src/lib/media/cover-preferences.test.ts:55` — Code: `src/lib/media/cover-preferences.ts:21-26`
- Now: without a pre-read map every call parses localStorage again.
- Wrong because: list renders call it per card; harmless today but a hidden perf cliff.
- Intended: migrate callers to pass the map, then drop the default.
- Risk: none functionally.
- Decision: Keep for now; track as a cleanup. Effort S.

## Local files (folder matching, renaming, game linking)

### 17. "Director's Cut" never matches
- Test: `src/lib/local/catalog-game-linking.test.ts:133` — Code: `src/lib/local/catalog-game-linking.ts:95-105`, `src/lib/local/folder-match.ts:8`
- Now: `normalizeForMatch` turns `Director's` into `director s`, so the trailing `s` token is not an edition keyword and the match fails.
- Wrong because: the apostrophe spelling is the common one on Steam; the game is not linked to its catalog entry.
- Intended: strip apostrophes before tokenising (`'s` -> `s`) or add `s` handling in the keyword check.
- Risk: `normalizeForMatch` is shared by every local matcher; changing it globally could alter folder scores. Prefer a local pre-pass in `findEditionPrefixMatch`.
- Decision: Fixed (apostrophes stripped in a `findEditionPrefixMatch`-local pre-pass). Effort S.

### 18. Episode marker `E` eats the title's trailing "e"
- Test: `folder-match.test.ts:352` — Code: `folder-match.ts:269`
- Now: `One Piece 1015.mkv` parses as episode 1015 with title `One Pie`.
- Wrong because: the regex allows `E` followed by an optional separator, so `e 1015` inside `Piece 1015` matches; the derived episode title is corrupted and later written into renamed filenames.
- Intended: require a non-letter before the `E` marker (`(?:^|[^a-z0-9])`).
- Risk: filenames like `TitleE01` (no separator) would stop matching; check fixtures.
- Decision: Fixed (`(?:^|[^a-z0-9])` boundary before `E`). Effort S.

### 19. "Vol. 3" / "Ch. 12" with dot + space not recognised
- Test: `folder-match.test.ts:335` — Code: `folder-match.ts:268-273`
- Now: markers accept one separator only; `Title Vol. 3 Ch. 12.cbz` falls back to the last standalone number and yields title `Title Vol. 3 Ch`.
- Wrong because: dot-plus-space is the most common human spelling for comics and novels.
- Intended: allow `[.\s_-]{0,2}` between keyword and number.
- Risk: low; the SEASON_EPISODE markers run first and are unaffected.
- Decision: Fix. Effort S.

### 20. Season-conflict penalty never rejects
- Test: `folder-match.test.ts:167` — Code: `folder-match.ts:121`
- Now: a conflicting season marker adds -1000 to the score but the folder is still returned when it is the only candidate.
- Wrong because: season 1 of a show gets matched to `Show S3` and its files are then scanned and renamed under the wrong season.
- Intended: treat a negative score as no match.
- Risk: users with a single misnamed folder currently get *some* match; they would get null and have to locate manually.
- Decision: Product decision. Effort S.

### 21. File match only checks filename-contains-title
- Test: `folder-match.test.ts:229` — Code: `folder-match.ts:207`
- Now: `Akira.mkv` does not match the title `Akira 1988 Remastered`; folders check both directions.
- Wrong because: asymmetric with `findMatchingFolder`; catalog titles with edition suffixes miss plain filenames.
- Intended: probably deliberate to avoid `A.mkv` matching everything; the comment at line 208 says so.
- Risk: reverse containment on files produces false positives for short filenames.
- Decision: Keep. Effort S.

### 22. Rename plan silently drops overflow files
- Test: `folder-match.test.ts:587` — Code: `folder-match.ts:601` and `:606`
- Now: a file whose episode number falls past every known season count is skipped (`continue`); the plan returns four renames for five files with no warning.
- Wrong because: the user sees "done" and one file stays unrenamed and unmatched.
- Intended: surface skipped files in the plan (`skipped: LocalFolderEntry[]`) and show them in the locate dialog.
- Risk: dialog UI and i18n strings for the new message.
- Decision: Product decision (silent vs reported). Effort M.

### 23. One-word titles never prefix-match an edition
- Test: `catalog-game-linking.test.ts:284` — Code: `catalog-game-linking.ts:100`
- Now: `Overwatch` will not link to `Overwatch Ultimate Edition`; only id or exact-name links work.
- Wrong because: single-word franchises are common.
- Intended: guard against `Doom` -> `Doom Eternal` is the reason; the edition-keyword check already rejects that, so the token-count guard may be redundant.
- Risk: false links for one-word titles whose extra tokens are all keywords (`Okami` vs `Okami HD` is tested as a non-match today).
- Decision: Keep unless users report it. Effort S.

## Character page

### 24. Duplicate "Blood Type" row
- Test: `src/lib/character/character-stats.test.ts:91` — Code: `src/lib/character/character-stats.ts:95`
- Now: the dedupe set registers `bloodtype` and `grupo sanguíneo`, but AniList biographies spell it `Blood Type`, so the structured row and the biography row both render.
- Wrong because: the character page shows two blood-type rows with different values.
- Intended: register `blood type` too, or normalise labels by removing spaces before lookup.
- Risk: none.
- Decision: Fixed (`blood type` registered as a dedupe key). Effort S.

## i18n

### 25. Locales cast from `es`; missing keys silently render Spanish
- Test: `frontend/tests/i18n-parity.test.ts:11` and `:60` — Code: `src/i18n/runtime.ts:42` (`deepMerge(es, ...)`)
- Now: `Translations = typeof es`; the other seven locales are cast, so `tsc` cannot see a missing key and runtime falls back to Spanish.
- Wrong because: a forgotten key ships as Spanish text in an English UI with no error.
- Intended: type each locale as `satisfies Translations` so the compiler enforces parity.
- Risk: `satisfies` on eight large files will surface every existing mismatch at once (the parity test already enforces it, so it should be zero today). Adds compile time.
- Decision: Keep the runtime fallback, but consider `satisfies` as a follow-up. Effort M.

## Rust

### 26. Screenshot label needs no word boundary before `S`
- Test: `frontend/src-tauri/src/folders/screenshots.rs:134` — Code: `screenshots.rs:24-53`
- Now: `Bus1e2.mkv` yields `S01E02`.
- Wrong because: any word containing `s<digits>e<digits>` becomes a fake episode label in screenshot filenames.
- Intended: require the byte before `S` to be non-alphanumeric.
- Risk: filenames like `ShowS01E02` (no separator) would stop matching; the frontend regex at `folder-match.ts:264` already requires a non-digit only, so the two parsers disagree either way.
- Decision: Fix, aligning with the frontend rule. Effort S.

### 27. Overflowing season number aborts the whole scan
- Test: `screenshots.rs:144` — Code: `screenshots.rs:49` (`parse::<u32>().ok()?`)
- Now: `S99999999999E01 S01E02` returns `None` because the `?` returns from the function instead of `continue`.
- Wrong because: a later valid marker is ignored; a garbage prefix kills the label.
- Intended: `continue` on parse failure.
- Risk: none.
- Decision: Fix. Effort S.

## Owner checklist

Tick one per row and, for "Fix", delete or invert the characterization test in the same commit.

- [ ] 1 Branch removal highlight — Fix / Keep / Product
- [ ] 2 Blank proposal field fallback — Fix / Keep / Product
- [ ] 3 Alias case dedupe — Fix / Keep / Product
- [ ] 4 Null relation_type overwrite — Fix / Keep / Product
- [x] 5 `blocked_at: null` on new entry — Fixed
- [ ] 6 Empty "before" relation type — Fix / Keep / Product
- [ ] 7 Session merge characters/authors — Fix / Keep / Product
- [ ] 8 Removed arc ids filter — Fix / Keep / Product
- [ ] 9 Character object wholesale replace — Fix / Keep / Product
- [x] 10 Topo sort edge outside list — Fixed
- [ ] 11 In-group positions without edges — Fix / Keep / Product
- [ ] 12 Lone grouped item group id — Fix / Keep / Product
- [ ] 13 Global numbering heuristic — Fix / Keep / Product
- [ ] 14 Theme range offset heuristic — Fix / Keep / Product
- [ ] 15 `total_count` refresh policy — Fix / Keep / Product
- [ ] 16 Legacy cover call shape — Fix / Keep / Product
- [x] 17 Director's Cut apostrophe — Fixed
- [x] 18 `E` marker eats title letter — Fixed
- [ ] 19 Dot-space volume markers — Fix / Keep / Product
- [ ] 20 Season-conflict never rejects — Fix / Keep / Product
- [ ] 21 One-way file title match — Fix / Keep / Product
- [ ] 22 Silent overflow drop in rename plan — Fix / Keep / Product
- [ ] 23 One-word edition prefix match — Fix / Keep / Product
- [x] 24 Duplicate Blood Type row — Fixed
- [ ] 25 Locale cast / Spanish fallback — Fix / Keep / Product
- [ ] 26 Screenshot `S` word boundary — Fix / Keep / Product
- [ ] 27 Screenshot season overflow abort — Fix / Keep / Product
