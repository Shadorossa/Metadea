# ✅ Pre-Commit Checklist

**Use this BEFORE `git commit`. It takes 5 minutes and prevents 80% of problems.**

---

## 🔍 Code Review (2 min)

- [ ] No duplicated code (constants, types, functions)
- [ ] Functions are < 150 lines
- [ ] Variable names are clear (no `x`, `temp`, `data`)
- [ ] No commented-out code (delete it)
- [ ] No `console.log()` in production code
- [ ] No `any` types without justification
- [ ] No try-catch without handling or re-throwing

---

## 🏗️ Architecture (1 min)

- [ ] New code in right folder structure
  - Routes in `src/routes/`
  - Lib/utils in `src/lib/`
  - Types in `src/types/`
- [ ] Imports are from correct layers
  - Don't import route code from types
  - Don't import route code from lib
- [ ] No circular dependencies
- [ ] Middleware/dependency injection correct

---

## 🧪 Tests (1 min)

- [ ] Tests written for new code
- [ ] Tests pass locally: `npm run test`
- [ ] Coverage > 80% for new code: `npm run test:coverage`
- [ ] Tests have clear names (describe what, not how)
- [ ] No flaky tests (doesn't fail randomly)

---

## 🔒 Security (1 min)

- [ ] Input validated (email, password, etc)
- [ ] No secrets in code
- [ ] SQL queries parameterized
- [ ] Auth middleware on protected routes
- [ ] CORS/headers correct

---

## 📊 Performance (1 min)

- [ ] No N+1 queries (use batching)
- [ ] No unnecessary loops/recursion
- [ ] Cache used appropriately
- [ ] API response < 500ms

---

## 📝 Documentation (1 min)

- [ ] CLAUDE.md updated with changes
- [ ] Function JSDoc if public
- [ ] Commit message explains WHY
- [ ] No TODO comments without GitHub issue link

---

## ✨ Quality Checks (automated)

**Run these before committing:**

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript strict
npm run test          # Vitest
npm run test:coverage # Coverage report
```

**If any fail:** Fix it now, don't commit broken code.

---

## 🚀 Ready to Commit?

**All of these must be YES:**

```
[ ] Lint passes (npm run lint)
[ ] TypeScript strict (npm run typecheck)
[ ] Tests pass (npm run test)
[ ] Coverage > 80% (npm run test:coverage)
[ ] No console.log in server code
[ ] CLAUDE.md updated
[ ] Commit message is clear
[ ] Can explain why this change exists
```

If any are NO → **Stop and fix before committing.**

---

## Red Flags (STOP and Refactor)

If you see these → **Do NOT commit:**

```typescript
// ❌ Function too big
async function handleComplexRequest() { // 200+ lines
  // ...
}

// ❌ `any` without reason
const data = response as any;

// ❌ Empty catch
try { riskyThing(); } catch {}

// ❌ Defensive check (means type isn't guaranteed)
const type = (value === 'games' || value === 'game') ? 'game' : value;

// ❌ Duplicated constant
const VALID_TYPES = ['anime', 'manga']; // Already in constants/types

// ❌ Test without assertion
it('should do something', () => {
  someFunction();
  // No expect()
});

// ❌ Secret in code
const apiKey = "sk-1234567890";

// ❌ Commented code
// const oldWay = fetchData();
const newWay = fetchDataV2();
```

**Fix these NOW, not in Phase 2.**

---

## Commit Message Template

```
<type>: <subject>

<body>

<footer>
```

### Type
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change with no behavior change
- `perf`: Performance improvement
- `test`: Add tests
- `docs`: Documentation
- `ci`: CI/CD changes
- `chore`: Dependency updates

### Subject
- Imperative, present tense: "add" not "added"
- No period at end
- < 50 characters
- Lowercase

### Body (optional)
- Explain **why**, not **what**
- Bullet points ok
- Wrap at 72 chars

### Footer
```
Closes #42
Breaking change: (if any)
```

### Example
```
feat: add externalId validation for library sync

Prevents users from syncing non-existent works to Turso.
Validates format (game:123) and calls IGDB/AniList APIs.
Caches results for 7 days to avoid repeated API calls.

Closes #42
```

---

## After Commit: PR Checklist

**Before pushing to GitHub:**

```bash
# One more time
npm run lint
npm run typecheck
npm run test

# Then push
git push origin branch-name
```

**In PR description, include:**

```markdown
## What
Brief description of what changed

## Why
Why this change was needed

## Tests
- [ ] Unit tests added
- [ ] Integration tests added
- [ ] Manual testing done

## Definition of Done
- [ ] Tests passing
- [ ] Coverage > 80%
- [ ] CLAUDE.md updated
- [ ] No breaking changes
- [ ] Deployment-safe
```

---

## If You're Tired

**If you've been coding > 4 hours:**
- Take a break
- Come back fresh
- Re-run all checks
- Review your own code

**Tired programmers make mistakes.** It's ok to call it a day.

---

## Questions?

1. **Does this violate a rule?** → Check DEVELOPMENT_RULES.md
2. **Is this the right way?** → Check examples in codebase
3. **Still stuck?** → Ask for help, don't guess

---

**Remember:** 5 minutes of checklist = 2 hours of debugging later.
