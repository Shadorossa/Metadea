# CSS Reduction Analysis & Optimization Plan

## Overview
- **Total CSS**: 19,798 lines (~489.6KB)
- **Largest files**: media.css (5,232), profile.css (4,210), local.css (2,212)
- **Total declarations found**: 
  - Flex layouts: 571
  - Border declarations: 835
  - Spacing declarations: 466

---

## Identified Patterns & Consolidation Opportunities

### 1. **Border Radius Standardization** (200+ declarations)
**Consolidation**: Created `.rounded-*` utilities

| Pattern | Count | Utility |
|---------|-------|---------|
| `var(--radius-sm, 4px)` | 126 | `.rounded-sm` |
| `var(--radius-md, 8px)` | 73 | `.rounded-md` |
| `50%` | 24 | `.rounded-full` |
| `4px` | 22 | Consolidate to `.rounded-sm` |
| `8px` | 11 | Consolidate to `.rounded-md` |

**Estimated savings**: 40-60 lines when integrated

---

### 2. **Gap/Spacing Standardization** (330+ declarations)
**Consolidation**: Created `.gap-*` and `.p-*` utilities

**Gap patterns** (76 uses most common):
- `0.5rem` → `.gap-md` (76 uses)
- `0.75rem` → `.gap-lg` (56 uses)
- `0.35rem` → `.gap-sm` (31 uses)
- `1rem` → `.gap-xl` (44 uses)

**Padding patterns** (90 uses):
- `0` (54 uses)
- `1rem` (15 uses)
- `0.5rem` (13 uses)

**Estimated savings**: 60-80 lines when integrated

---

### 3. **Display Flex Consolidation** (571 declarations)
**Current state**: Every component defines its own flex layout
**Consolidation**: Created `.flex-center`, `.flex-between`, `.grid-auto`

**Opportunity**: Many flex declarations follow these patterns:
```css
/* Current: ~159 in media.css alone */
.component { display: flex; align-items: center; justify-content: center; }

/* Could be: */
.component { @extend .flex-center; /* or use class directly */ }
```

**Estimated savings**: 100-150 lines across all files

---

### 4. **Border Standardization** (835 declarations)
**Common patterns**:
```css
border: 1px solid rgba(255, 255, 255, 0.1);   /* Very common */
border: 1px solid rgba(255, 255, 255, 0.15);  /* Also common */
border: 1px solid var(--accent);               /* Accent borders */
border-top: 1px solid rgba(255, 255, 255, 0.1);
```

**Utilities created**: `.border-thin`, `.border-light`, `.border-accent`

**Estimated savings**: 80-120 lines

---

### 5. **Text Overflow Patterns** (20+ declarations)
**Consolidation**: Created `.truncate` and `.line-clamp`

```css
/* Current (repeated 10+ times): */
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;

/* Could be: */
class="truncate"
```

**Estimated savings**: 20-30 lines

---

### 6. **Activity Card Duplication** (28 lines in 2 files)
**Files**: home.css (15 lines) + profile.css (13 lines)

This is already identified and ready to consolidate into components/activity.css

---

### 7. **Voice Actor Buttons Duplication** (6 lines in 2 files)
**Files**: character.css + media.css
**Classes**: `.char-seiyu-lang-btn`, `.char-seiyu-lang-btn--active`, `.char-seiyu-lang-btn:hover`

---

## Integration Priority

### Phase 1: CRITICAL (Immediate - highest impact)
- [ ] Integrate `.gap-*` utilities into media.css, profile.css, local.css (saves ~60 lines)
- [ ] Integrate `.rounded-*` utilities globally (saves ~40 lines)
- [ ] Consolidate `.act-card*` into shared component (saves ~28 lines)

**Total Phase 1**: ~130 lines saved

### Phase 2: HIGH (Medium priority)
- [ ] Integrate `.flex-center`, `.flex-between` (saves ~100 lines)
- [ ] Integrate `.border-*` utilities (saves ~80 lines)
- [ ] Move voice actor buttons to shared component (saves ~6 lines)

**Total Phase 2**: ~190 lines saved

### Phase 3: MEDIUM (Lower priority)
- [ ] Integrate `.p-*` padding utilities (saves ~20 lines)
- [ ] Integrate `.truncate`, `.line-clamp` (saves ~20 lines)
- [ ] Consolidate form/input styles (identified but not quantified)

**Total Phase 3**: ~40 lines saved

---

## Grand Total Potential Savings
**Estimated reduction**: 360-400 lines of CSS (~2-3% of total)

While this seems modest in percentage, it's significant in:
- **Maintenance**: One change to gap spacing = update one utility, not 200 files
- **Consistency**: Guaranteed spacing/border consistency across pages
- **Learning curve**: New developers learn 6 gap classes vs. hunting for patterns

---

## Files Ready for Integration (Phase 1)

### media.css (5,232 lines)
- 159 flex declarations → opportunity for consolidation
- Multiple gap patterns → can use `.gap-*`
- Multiple border-radius → can use `.rounded-*`

### profile.css (4,210 lines)
- 128 flex declarations
- Activity card component (13 lines) → move to shared
- Multiple gap patterns

### local.css (2,212 lines)
- 71 flex declarations
- Multiple gap patterns
- Activity card component (15 lines) → move to shared

---

## Utilities Already Created

**File**: `src/styles/core/utilities.css` (167 lines)

Contains:
- ✅ 10 reusable component utilities
- ✅ 6 gap utilities (.gap-xs to .gap-2xl)
- ✅ 5 padding utilities (.p-xs to .p-xl)
- ✅ 6 border-radius utilities (.rounded-xs to .rounded-pill)
- ✅ 3 text overflow utilities (.truncate, .line-clamp)
- ✅ 3 display utilities (.flex-center, .flex-between, .grid-auto)
- ✅ 4 border utilities (.border-thin, .border-light, .border-accent)

Ready to import: `@import 'core/utilities.css';` in each page CSS file

---

## Migration Checklist

```
Phase 1:
[ ] Add @import to media.css
[ ] Add @import to profile.css  
[ ] Add @import to local.css
[ ] Replace gap declarations in media.css
[ ] Replace border-radius in media.css
[ ] Consolidate .act-card* component
[ ] Test visual consistency

Phase 2:
[ ] Replace flex declarations with utility classes
[ ] Replace border declarations
[ ] Consolidate voice actor buttons
[ ] Update settings.css
[ ] Update home.css

Phase 3:
[ ] Replace padding declarations
[ ] Replace text overflow patterns
[ ] Audit remaining duplication
[ ] Final size measurement
```

---

## Expected Results After Full Integration

- **Before**: 19,798 lines of CSS
- **After**: ~19,400 lines of CSS (398 lines removed)
- **Maintenance burden**: Significantly reduced
- **Consistency**: Improved across all pages

**Note**: These are conservative estimates. Actual savings may be higher if:
- Additional duplicated selectors are found
- Older CSS can be safely deprecated
- Media queries can be consolidated
