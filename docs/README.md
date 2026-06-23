# 📚 Metadea Development Documentation

This folder contains the principles, rules, and roadmap for building Metadea sustainably.

---

## Quick Start

**First time here?** Read in this order:

1. **[LESSONS_FROM_METAMEDIA.md](./LESSONS_FROM_METAMEDIA.md)** (15 min)
   - What went wrong with the previous project
   - Why we need different rules
   - What to watch for

2. **[DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)** (20 min)
   - 10 rules that keep us from repeating Metamedia
   - Definition of Done
   - How we enforce quality

3. **[30_DAY_ROADMAP.md](./30_DAY_ROADMAP.md)** (10 min)
   - What we're building and when
   - Success metrics for each phase
   - When we're "done"

---

## For New Contributors

1. Read the docs above (45 min)
2. Run the project locally
3. Pick a task from the roadmap
4. Follow DEVELOPMENT_RULES while coding
5. Make sure Definition of Done is met before PR

---

## Key Principles

### ❌ What We Won't Do
- Ship code without tests
- Refactor without updating docs
- Let tests fail without fixing them
- Add features before finishing the previous one
- Ignore security/performance issues
- Skip the Definition of Done

### ✅ What We Will Do
- Plan before coding
- Test as we build
- Update docs same commit as code
- Finish one feature completely before the next
- Review each other's code
- Deploy only when all checks pass

---

## Reference

### Decision Making
When in doubt, ask these questions (in order):
1. **Is this secure?** (no ≠ ship)
2. **Will tests pass?** (no ≠ ship)
3. **Is performance acceptable?** (no ≠ ship)
4. **Will it be easy to maintain?** (no ≈ refactor)
5. **Can we ship it faster a different way?** (yes ≈ do)

### Emergency Override
Only the project lead can override these rules, and only for security or critical production bugs.

### When Rules Conflict
Precedence: **Security > Correctness > Performance > Maintainability > Speed**

---

## Team Norms

### Code Review
- At least 1 approval before merge
- Reviewer checks:
  - Tests pass
  - Definition of Done met
  - No rule violations
  - Code is readable

### Standups (optional but recommended)
- 5 min daily
- What I did yesterday
- What I'm doing today
- Any blockers

### Communication
- Blockers? Don't suffer silently, ask for help
- Design questions? Discuss before coding
- Found a bug? Document it as GitHub issue

---

## Tools & Setup

Required before first commit:

```bash
# Install dependencies
npm install

# Set up pre-commit hooks
npx husky install

# Run all checks locally
npm run lint
npm run typecheck
npm run test

# Before committing
npm run pre-commit
```

---

## Success Metrics for the Project

After 30 days:
- ✅ 200+ passing tests
- ✅ >85% code coverage
- ✅ 0 security issues
- ✅ All endpoints documented
- ✅ Deployable to production
- ✅ No technical debt accumulating

After 3 months:
- ✅ 500+ passing tests
- ✅ >85% code coverage
- ✅ Live with real users
- ✅ <100ms response time p95
- ✅ Zero unplanned downtime
- ✅ Code is still easy to change

---

## FAQ

**Q: Can I skip tests?**
A: No. Tests are code. They're as important as features.

**Q: Can I merge with failing tests?**
A: No. Fix them first.

**Q: Can I add "just one more feature"?**
A: No. Finish current one, then propose the next.

**Q: Can I refactor without updating tests?**
A: No. Same commit.

**Q: Can I ship without docs?**
A: No. Docs are part of Definition of Done.

**Q: What if I disagree with a rule?**
A: Suggest a change in a pull request to this file. Team votes.

---

## Getting Help

- **Technical blocker?** Ask in a comment on your PR
- **Design question?** Create a discussion issue
- **Rule clarification?** Ask the team
- **Overwhelmed?** Let's pair program

---

## Resources

- [CLAUDE.md](../CLAUDE.md) - Architecture & API docs (root)
- [Node.js Docs](https://nodejs.org/docs/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Turso Docs](https://docs.turso.tech/)

---

**Last updated:** 2026-06-23
**Version:** 1.0
**Status:** Active (Enforced on all PRs)
