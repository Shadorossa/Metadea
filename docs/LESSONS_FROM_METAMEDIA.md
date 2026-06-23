# ⚠️ Lessons from Metamedia: What Went Wrong

## Overview
Metamedia was a 10/10 ambitious project that accumulated **150 test failures**, widespread tech debt, and multiple "quality improvement sprints" that were actually damage control attempts.

This document catalogs the mistakes so Metadea doesn't repeat them.

---

## The Problems

### 1. Uncontrolled Scaling
**What happened:**
- Started as simple media catalog
- Grew to 40+ features without stopping
- Each new feature broke previous ones

**Symptoms in codebase:**
```
src/features/
├── activity/        ← Added later
├── admin/          ← Added later
├── auth/
├── characters/     ← Added later (broke other things)
├── friendships/    ← Added later
├── library/
├── notifications/  ← Added later
├── sagas/         ← Added later (complex logic)
├── statistics/
├── users/
└── wraps/         ← Added later
```

**Result:** No one could reason about the system anymore.

---

### 2. Test Abandonment
**What happened:**
- Tests existed initially
- When code refactored, tests weren't updated
- "We'll fix them later" → Never happened
- 150 tests failed without anyone noticing

**Evidence from CLAUDE.md:**
```
150 test failures as of June 2026:
- FriendshipService.test.ts: 27 tests (service deleted, logic moved)
- NotificationService.test.ts: 24 tests (service deleted)
- SagaService.test.ts: 20 tests (interface changed)
- UnifiedMediaFetcher.test.ts: 11 tests (interface changed)
- ... and 68 more

"None are production bugs" = LIE
If tests break without being caught, they're not being run.
```

**Root cause:** No CI/CD enforcement. No pre-commit hooks.

---

### 3. Refactors Without Discipline
**What happened:**
```
Day 1:  Move logic from service → endpoint
Day 2:  Tests break
Day 3:  "We'll update tests later"
Month 3: Tests still broken, no one remembers why
```

**Examples:**
- `FriendshipService` deleted but 27 tests still referenced it
- `UnifiedMediaFetcher` interface changed, 11 tests failed
- No one updated docs or tests simultaneously with code changes

---

### 4. Documentation as Afterthought
**What happened:**
- CLAUDE.md written AFTER 150 test failures existed
- Reads like a post-mortem, not a guide
- "Sprint A: Fixed X, Sprint B: Fixed Y" = damage control narrative

**Red flags in the text:**
```markdown
### Sprint A: Critical Security & Testing Fixes ✅
- Sanitizer.ts: Fixed HTML tag regex (preserves math symbols `<100`)
→ Why was this broken? Why fixed late?

### Sprint B: Type Safety (Zero `as any`) ✅
- Eliminated all 22 `as any` castings
→ Why were there 22 to begin with?

### Final Score: 10/10 ✅
→ But 150 tests fail. How is this 10/10?
```

---

### 5. Feature Creep
**What happened:**
- Every PR added new features without closing old ones
- No "Definition of Done" (tests + docs + perf check)
- Scope grew infinitely

**Timeline reconstruction:**
```
Month 1: Auth ✅
Month 2: Library ✅
Month 3: Search (75%), Stats (50%), Characters (40%)
Month 4: Friends (60%), Admin (70%), Wraps (?)
Month 5: Sagas (high-complexity), Notifications
Month 6: "Let's do quality improvements!" (Sprint A-F)
```

Each new feature was 50-80% done before the next started.

---

## Why It Matters for Metadea

If we repeat these patterns:

1. **In 2 months:** System too complex to understand
2. **In 4 months:** Tests failing silently
3. **In 6 months:** Refactors break production
4. **In 8 months:** "Quality sprints" (damage control)
5. **In 12 months:** Project unmaintainable

---

## The Root Causes

### Lack of Process
- No formal feature planning
- No "Definition of Done" checklist
- No CI/CD blocking bad commits
- No architecture review before coding

### Lack of Discipline
- Tests updated when convenient, not when code changed
- Docs written after code, not with it
- Refactors completed without updating dependents
- "Technical debt payoff" treated as separate from development

### Lack of Constraints
- No scope limits per sprint
- No "max WIP" rule
- Features could be 50% done forever
- No one said "no"

---

## Key Insight

**Metamedia didn't fail because the code was bad.**
**It failed because the PROCESS was bad.**

A junior dev following good process beats a senior dev with no process.
