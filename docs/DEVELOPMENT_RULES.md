# 🎯 Metadea Development Rules

These rules prevent us from becoming Metamedia 2.0.

---

## RULE 1: Plan Before Code

**Every feature needs a plan document BEFORE you write code.**

### Format (max 2 hours to write)

```markdown
# Feature: [Name]

## What is this?
- 2-3 sentence description
- What problem does it solve?

## Scope (MUST INCLUDE "NOT" section)
✅ In scope:
- Create library item
- Validate against IGDB

❌ NOT in scope (explicitly exclude):
- Edit library item (Phase 2)
- Batch operations (Phase 2)
- Social features (Phase 3)

## Dependencies
- Requires: User authentication (done in Phase 0)
- Blocks: (nothing)
- Blocked by: (nothing)

## Architecture
- Tables: user_library
- Endpoints: POST /api/library/sync
- Services: ValidationService, TursoService

## Risks
- IGDB API might rate-limit → Solution: cache validation results
- Turso might be slow → Solution: pagination

## Tests needed
- [ ] Happy path: valid externalId → saved
- [ ] Error path: invalid externalId → rejected
- [ ] Edge case: duplicate externalId → update
```

**Before coding:** Post in pull request description, get approval.

---

## RULE 2: One Feature = Complete Loop

**NO:** Feature A (50%) → Feature B (40%) → Feature C (30%)

**YES:** Feature A (100% DONE) → Feature B → Feature C

### Definition of Done

A feature is DONE when ALL of these are true:

- ✅ Code written and reviewed
- ✅ Tests written and passing (>80% for new code)
- ✅ CLAUDE.md / Architecture docs updated
- ✅ Commit message explains the "why"
- ✅ No breaking changes to existing APIs
- ✅ Performance acceptable (no N+1 queries, etc)
- ✅ Security review passed (input validation, auth, etc)
- ✅ Can be deployed without hotfixes

### Example: Library Sync Feature

**Phase 1: Validation (1-2 days)**
```
✅ Design: What does validateExternalId need?
✅ Code: Write validation logic
✅ Tests: Unit tests for each validation case
✅ Docs: Update CLAUDE.md
✅ Commit: "feat: implement externalId validation"
✅ Ready to merge
```

**Phase 2: Database (1-2 days)**
```
✅ Design: Schema for user_library
✅ Code: saveLibraryItem() function
✅ Tests: Integration tests with Turso
✅ Docs: Update CLAUDE.md
✅ Commit: "feat: persist library items to Turso"
✅ Ready to merge
```

**Phase 3: API (1 day)**
```
✅ Design: POST /api/library/sync endpoint
✅ Code: Wire up validation + persistence
✅ Tests: E2E test client → validation → DB
✅ Docs: API documentation
✅ Commit: "feat: add /api/library/sync endpoint"
✅ Ready to merge
```

---

## RULE 3: Tests Are Code

**When you change code, update tests in THE SAME COMMIT.**

❌ **Bad:**
```
Commit 1: feat: refactor saveLibraryItem()
Commit 2: (1 month later) fix: update tests for saveLibraryItem
```

✅ **Good:**
```
Commit 1: refactor: split saveLibraryItem() into smaller functions

- Move item validation → validateItem()
- Move DB insert → insertToDatabase()
- Keep tests passing for both
- Update tests to cover new split
```

### Pre-commit Check
```bash
# Before git commit, ensure:
npm run test          # All tests pass
npm run test:coverage # Coverage > 80% for new code
npm run typecheck     # TypeScript strict mode
npm run lint          # ESLint passes
```

If any fail → Fix it now, don't commit broken code.

---

## RULE 4: Documentation is Alive

**Update docs WHEN YOU CHANGE CODE, not after.**

### When to update CLAUDE.md

1. **New architecture decision?** → Add to ARCHITECTURE section
2. **New API endpoint?** → Document it immediately
3. **New validation rule?** → Note it in Security section
4. **Refactored a service?** → Update the description
5. **Added a new table?** → Update the database schema section

### Example Commit

```
feat: add library sync with validation

- Implement validateExternalId() for IGDB/AniList
- Create POST /api/library/sync endpoint
- Update CLAUDE.md with new endpoint docs
- Tests cover happy path + error cases
- No breaking changes
```

---

## RULE 5: CI/CD from Day 1

**No commits bypass these checks:**

```yaml
Pre-commit hook:
  - npm run lint          (must pass)
  - npm run typecheck     (must pass)
  - npm run test          (must pass)

PR check:
  - npm run test:coverage (must be > 80% for new code)
  - npm run build         (must succeed)

Before merge:
  - All tests passing
  - All checks green
  - At least 1 approval
```

**If checks fail → Fix it before merging, no exceptions.**

---

## RULE 6: Scope Discipline

**Features have LIMITS. No feature is "just add this too..."**

### Scope Creep Kill List

When someone says:
| Phrase | Response |
|--------|----------|
| "While we're at it..." | No. Create an issue for Phase 2. |
| "Let's just add..." | No. Out of scope. Document and park. |
| "We might need later..." | No. Build when needed, not preemptively. |
| "Small change..." | No. Any change needs a feature branch. |

### WIP (Work In Progress) Limits

**Maximum 2 features being actively developed at once.**

If someone says "I'm working on 3 things," prioritize to 1, move others to Backlog.

---

## RULE 7: Feature Gates / Kill Switches

**New features don't affect old features.**

```typescript
// ✅ GOOD: Feature hidden behind a flag
if (env.ENABLE_LIBRARY_SYNC) {
  router.post("/api/library/sync", syncLibrary);
}

// ❌ BAD: Refactor that touches existing code
router.post("/api/library/sync", syncLibrary); // Breaks existing endpoints

// ✅ GOOD: New endpoint, separate logic
router.post("/api/library/batch", batchSync);

// ❌ BAD: Modifying old endpoint to do new thing
router.post("/api/library", (req) => {
  if (isBatch) newLogic();
  else oldLogic();
});
```

**Old code doesn't change unless necessary.**

---

## RULE 8: "Don't Fix It, Build It Right"

**Technical debt is allowed to exist, but only if documented.**

### Allowed Tech Debt
```typescript
// TODO: Replace stub validation with real IGDB API call
// Issue: #42 (1 day of work)
async function validateIGDB(gameId: number): Promise<boolean> {
  return gameId > 0; // Stub
}
```

### Not Allowed Tech Debt
```typescript
// This should work but no one knows why it works
const data = (response as any).data;

// Commented code that might be needed someday
// const oldWay = fetchFromCache();

// Unused function that might be called
export function neverCalled() { }
```

**TODO: Link to issue. If no issue, delete it.**

---

## RULE 9: Commit Messages Explain Why

**Bad commit messages:**
- `fix: bug`
- `feat: add stuff`
- `refactor: cleanup`

**Good commit messages:**
```
feat: implement externalId validation against IGDB

Prevents users from syncing non-existent games to Turso.
Validates format (game:12345) and calls IGDB API (with caching).
Falls back gracefully if IGDB is slow/down.

Closes #42
```

**Why?** Future you will read this commit message at 2am debugging production.

---

## RULE 10: Explicit Limits

### Repository Limits
- Max file size: 200 lines (split if bigger)
- Max function size: 150 lines (split if bigger)
- Max parameters: 5 (more = refactor)
- Max nesting depth: 3 levels

### Performance Limits
- API response: <500ms p95
- DB query: <100ms
- No N+1 queries
- No more than 10 simultaneous requests

### Coverage Limits
- New code: >80% test coverage
- Critical paths: >90% coverage
- Production code: No unhandled errors

---

## When These Rules Compete

**Precedence (highest to lowest):**

1. **Security** (always)
2. **Correctness** (tests must pass)
3. **Performance** (measurable impact)
4. **Maintainability** (code clarity)
5. **Speed** (shipping fast)

If shipping fast breaks security → don't ship.
If security breaks performance → fix perf in Phase 2.

---

## Enforcing Rules

- **Pre-commit hooks** run locally (Husky)
- **CI/CD** enforces on GitHub
- **Code review** checks for rule violations
- **Team syncs** discuss exceptions (rare)

**Breaking these rules is a blocker for merge.**

No exceptions, no "we'll fix it later."
