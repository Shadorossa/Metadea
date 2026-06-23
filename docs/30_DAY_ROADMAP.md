# 🗓️ Metadea: 30-Day Roadmap

**Goal:** Build a solid, maintainable foundation. Each phase is 100% complete before the next starts.

---

## Timeline Overview

```
Week 1 (Days 1-7):   Authentication & Session Management
Week 2 (Days 8-14):  Library CRUD & Turso Sync
Week 3 (Days 15-21): Validation & Public Profiles
Week 4 (Days 22-30): Deployment & Polish
```

---

## WEEK 1: Authentication (Days 1-7)

### Goal
Users can register, login, and maintain authenticated sessions.

### Features
- [x] Register endpoint (email + password)
- [x] Login endpoint (JWT token)
- [x] Session management (httpOnly cookies)
- [x] Logout endpoint
- [x] Auth middleware
- [ ] Password reset (stretch goal)

### Definition of Done
- ✅ All 5 endpoints working
- ✅ Tests: >80% coverage
  - Happy path: register → login → authenticated request
  - Error path: invalid email, weak password, wrong password
  - Edge case: duplicate email, concurrent login
- ✅ Security reviewed:
  - Passwords hashed (bcrypt)
  - JWT tokens with expiry
  - CORS configured
  - Rate limiting on login (5 per 10min)
- ✅ CLAUDE.md updated with auth section
- ✅ Can merge without hotfixes

### Files to Create
```
src/
├── routes/auth.ts
├── lib/
│   ├── jwt.ts (createToken, verifyToken)
│   ├── passwords.ts (hash, verify)
│   └── auth-middleware.ts (requireAuth, requireVerified)
└── types/auth.ts
```

### Commits
```
1. feat: add user authentication (register/login/logout)
   - Implement JWT-based session management
   - Hash passwords with bcrypt
   - Validate email format + password strength
   
2. feat: add auth middleware
   - requireAuth checks JWT in cookie
   - requireVerified ensures email verified
   
3. test: add authentication tests
   - Register happy path + error cases
   - Login with valid/invalid credentials
   - Session persistence
   
4. docs: update CLAUDE.md with auth architecture
```

### Success Metrics
- All tests passing
- Coverage > 85%
- Can register, login, and access protected endpoints
- Session persists across requests

---

## WEEK 2: Library CRUD (Days 8-14)

### Goal
Users can add, view, edit, delete items in their library. Data syncs to Turso.

### Features
- [ ] Create library item
- [ ] Read user's library
- [ ] Update item (status, rating)
- [ ] Delete item
- [ ] List with pagination

### Definition of Done
- ✅ All 5 endpoints working
- ✅ Tests: >80% coverage
  - CRUD happy paths
  - Ownership validation (can't edit other's items)
  - Pagination edge cases
- ✅ Database working:
  - user_library table working in Turso
  - Proper indexes for user_id
- ✅ CLAUDE.md updated with library schema
- ✅ No performance issues (response < 200ms)

### Files to Create
```
src/
├── routes/library.ts (refactor from Phase 0)
│   ├── createItem()
│   ├── getLibrary()
│   ├── updateItem()
│   ├── deleteItem()
└── lib/
    └── library-service.ts (business logic)
```

### Commits
```
1. feat: add library CRUD endpoints
   - POST /api/library (create)
   - GET /api/library (read with pagination)
   - PUT /api/library/:id (update)
   - DELETE /api/library/:id (delete)
   
2. feat: add ownership validation
   - Users can only modify their own items
   
3. test: add library CRUD tests
   - Create, read, update, delete happy paths
   - Ownership validation
   - Pagination
   
4. perf: optimize library queries
   - Add index on user_id
   - Pagination to prevent huge responses
   
5. docs: update CLAUDE.md with library endpoints
```

### Success Metrics
- All CRUD operations work
- Coverage > 85%
- Response time < 200ms
- Can't access/modify other users' data

---

## WEEK 3: Validation & Public Profiles (Days 15-21)

### Goal
- Prevent fake works (validate externalIds against IGDB/AniList)
- Users can view other users' public libraries

### Features
- [ ] Real IGDB API validation (replace stub)
- [ ] Real AniList API validation (replace stub)
- [ ] Public profile endpoint
- [ ] Public library view (read-only)
- [ ] Caching for validation results

### Definition of Done
- ✅ Validation working:
  - Calls real IGDB API
  - Calls real AniList API
  - Rejects invalid externalIds
- ✅ Public profiles working:
  - User profile (username, bio, avatar)
  - Public library (others can see)
  - Rate limiting on public endpoints
- ✅ Tests: >80% coverage
- ✅ Security reviewed:
  - No private data leaked
  - Rate limiting prevents enumeration
  - API errors don't expose internals

### Files to Create / Update
```
src/
├── routes/
│   ├── validation.ts (validateExternalId with real APIs)
│   └── profiles.ts (public endpoints)
├── lib/
│   ├── igdb.ts (real IGDB client)
│   ├── anilist.ts (real AniList GraphQL)
│   └── validation-cache.ts (cache validation results)
```

### Commits
```
1. feat: integrate real IGDB API validation
   - Call IGDB endpoint to verify game exists
   - Cache results (7-day TTL)
   - Rate-limit to prevent abuse
   
2. feat: integrate real AniList validation
   - Query AniList GraphQL for anime/manga
   - Cache results
   
3. feat: add public profile endpoint
   - GET /api/profiles/:username
   - Return public user data
   
4. feat: add public library view
   - GET /api/profiles/:username/library
   - Pagination
   - Read-only
   
5. test: validation + profile tests
6. docs: API documentation
```

### Success Metrics
- Only valid works can be added
- Public profiles visible to anyone
- No private data leaks
- Validation fast (<500ms with cache)

---

## WEEK 4: Deployment & Polish (Days 22-30)

### Goal
Ready for real users. All pieces working together.

### Features
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Pre-commit hooks
- [ ] Performance testing
- [ ] Security audit
- [ ] Documentation complete

### Definition of Done
- ✅ All tests passing (>85% coverage)
- ✅ No TypeScript errors
- ✅ No ESLint warnings
- ✅ GitHub Actions green on all PRs
- ✅ CLAUDE.md complete and accurate
- ✅ API docs generated
- ✅ Ready to invite beta users

### Files to Create
```
/.github/workflows/
├── test.yml (runs tests on PR)
├── lint.yml (checks code style)
└── build.yml (ensures production build works)

/.husky/
├── pre-commit (local checks)

/docs/
├── API.md (endpoint documentation)
├── DEPLOYMENT.md (how to deploy)
└── TROUBLESHOOTING.md (common issues)
```

### Commits
```
1. ci: add GitHub Actions workflows
   - Test on every PR
   - Lint on every PR
   - Block merge if failing
   
2. ci: add pre-commit hooks
   - npm run lint
   - npm run typecheck
   - npm run test (critical tests only)
   
3. docs: generate API documentation
4. docs: deployment guide
5. perf: benchmark critical paths
6. refactor: remove TODOs where possible
```

### Success Metrics
- All commits automatically checked
- GitHub Actions all green
- No failing tests
- Documentation up-to-date
- Ready for production deploy

---

## Key Checkpoints

### After Week 1
```
✅ Can register user
✅ Can login (get JWT)
✅ Can access protected endpoints
✅ Sessions work across requests
```

### After Week 2
```
✅ Can add item to library
✅ Can view own library
✅ Can edit own items
✅ Can delete own items
✅ Can't access/modify other users' data
```

### After Week 3
```
✅ Can only add real works (validated)
✅ Can see other users' public libraries
✅ Can't see private data
✅ Validation fast with caching
```

### After Week 4
```
✅ All tests passing
✅ All CI/CD green
✅ Documentation complete
✅ Ready for beta users
```

---

## Rules During Development

**MUST FOLLOW:**
1. Each feature is 100% done before next starts
2. Tests written with code, not after
3. CLAUDE.md updated same commit as code
4. No feature branches with breaking changes
5. Pre-commit checks pass before committing
6. Code review before merge

**If stuck:**
- Document the blocker
- Move to "Phase 2" and keep going
- Never merge with known issues

---

## After Day 30

### Phase 2 Features (Not in this roadmap)
- [ ] Password reset
- [ ] Email verification
- [ ] User bio/avatar
- [ ] Friendship requests
- [ ] Activity feed
- [ ] Search across libraries
- [ ] Statistics (hours watched, etc)
- [ ] Export/backup

### But only if:
- Phase 1 is solid (no bugs reported)
- Tests still > 85% coverage
- Performance still good
- No technical debt accumulating

---

## Daily Cadence

```
Morning (30 min):
  - Review previous day's PR feedback
  - Plan today's task
  - Check if blocked

During day:
  - Code + tests (together)
  - Run pre-commit checks
  - Update docs
  - Commit with good message

Evening (15 min):
  - PR ready for review
  - Run full test suite locally
  - Update roadmap if blocked
```

---

## Escalation Path

**If stuck > 2 hours:**
1. Document the problem
2. Try a different approach
3. Ask for pair programming
4. Move to "later" and keep going

**Never:** Work around issues or merge broken code.
