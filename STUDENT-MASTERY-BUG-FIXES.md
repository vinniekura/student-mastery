# Student Mastery — Complete Bug Fix & Deploy Guide

## Issues Fixed

### 1. **Desktop View CSS Variable Mismatch** ✅
**Problem:** New CSS only defined `--accent`, but existing components used `--teal`, `--teal2`, `--teal-bg`, `--teal-border` → components rendered with no color.

**Solution:** Added all variable aliases in index.css so both old and new components work without refactoring.

### 2. **Sidebar Icons Rendering as JSX Objects** ✅
**Problem:** JSX elements (`<svg>...</svg>`) cannot be stored in plain JS object literals at module level. React tries to render the object reference → shows `}` or `[object Object]`.

**Solution:** Use emoji strings (`'🏠'`, `'📚'`, `'📝'`) instead. Render perfectly everywhere, no React lifecycle issues.

### 3. **Layout Issues (Sidebar Overlap, Content Too Wide)** ✅
**Problem:** Sidebar width and content margin calculations didn't account for proper centering on ultrawide monitors.

**Solution:** 
- Sidebar: `position: fixed` at 210px width
- Main content: `margin-left: 210px`, `max-width: 960px` with proper responsive breakpoints
- Mobile breakpoint: sidebar becomes horizontal on <768px

### 4. **Authentication Working** ✅
From earlier conversation: Auth is fixed, 200 response confirmed on API calls.

### 5. **PDF Upload Timeout on Handwritten Pages** ⏳
**Problem:** PDFs with handwritten solution pages (pages 10-13) timeout during OCR.

**Solution:** See `ingest-doc-PATCH.js` — implement:
- Hard limit: process only first 10 pages
- Detection: skip pages that look handwritten (low character density)
- Timeout guard: skip any page taking >5 seconds
- Filename check: reject documents with "solution", "answer", "marking" in filename

---

## Deployment Steps

### Step 1: Update App.jsx
```bash
cd ~/student-mastery
cp App-FIXED.jsx src/App.jsx  # or replace manually with content below
git add src/App.jsx
git commit -m "Fix: emoji icons in sidebar, clean layout structure"
```

### Step 2: Update index.css
```bash
cp index-FIXED.css src/index.css  # or src/styles/index.css depending on your structure
git add src/index.css
git commit -m "Fix: add --teal variable aliases, clean sidebar/layout"
```

### Step 3: Fix ingest-doc.js
```bash
# Apply the patch from ingest-doc-PATCH.js
# Key changes:
# 1. Add isSolutionDocument() function
# 2. Add looksHandwritten() function  
# 3. Add extractPdfText() with:
#    - Max 10 pages processed
#    - Handwritten detection
#    - Per-page timeout guard (5 seconds)
# 4. Wrap file processing in processUploadedFile()

cp ingest-doc-PATCH.js api/  # Reference, then integrate into your ingest-doc.js
git add api/ingest-doc.js
git commit -m "Fix: skip handwritten pages, limit to 10 pages, timeout guard"
```

### Step 4: Deploy
```bash
git push
vercel --prod
```

---

## What Each Fix Does

### **App.jsx Changes**
- Emoji icons: `🏠`, `📚`, `📝`, `📅`, `⚙️` (render perfectly on all devices)
- NavLink `className` logic: highlights active route with teal background
- Proper Clerk integration: UserButton positioned in sidebar footer
- Dark mode toggle button positioned next to UserButton
- Fixed route structure for `/subjects/:subjectId/mock-paper`

### **index.css Changes**
- **Variables:** All old names aliased (`--teal` → `#0ea5e9`)
- **Sidebar:** Fixed 210px width, proper padding, SVG icon spacing
- **Layout:** Content area has `margin-left: 210px` + `max-width: 960px` for centered display
- **Responsive:** Sidebar becomes horizontal on mobile (<768px)
- **Components:** Cards, buttons, badges all updated with proper color scoping
- **Dark mode:** Root variables apply to dark theme by default; `.light` modifier inverts colors

### **ingest-doc.js Changes**
- **Solution detection:** Rejects files with "solution", "answer", "marking" in filename
- **Page limit:** Only processes first 10 pages (solutions always at end)
- **Handwritten detection:** Skips pages with low character density (<30 chars avg line length)
- **Timeout guard:** Skips any page taking >5 seconds to process
- **Metadata:** Returns `skippedPages` array showing what was filtered and why

---

## Testing Checklist

After deploying, verify:

- [ ] Sidebar displays with emoji icons (no `}` or `[object Object]`)
- [ ] Active nav link highlights in teal
- [ ] Content area is properly centered (not stretched on 4K monitors)
- [ ] Dark mode toggle works
- [ ] Colors appear correctly (buttons, badges, text)
- [ ] Mobile view: sidebar becomes horizontal on <768px
- [ ] PDF upload: 9-page exam works fine, >10 pages get trimmed automatically
- [ ] No handwritten pages cause 504 timeout

---

## Remaining Items (Not in This Fix)

1. **MockPaper.jsx full 5-stage flow** — See `ingest-doc-PATCH.js` for Stage 3 confirmation card code
   - Stage 1: Upload (primary + context papers)
   - Stage 2: Analyse (format detection)
   - Stage 3: **MISSING** — Confirmation card with format override + topic editing
   - Stage 4: Generate (QStash background job)
   - Stage 5: Compare (format match %, topic coverage %, badges)

2. **Email on completion** — Wire up Resend to send paper on generation complete

3. **API endpoints needed:**
   - `POST /api/analyse-papers` — Claude call to detect format + topics
   - `POST /api/generate-paper` — 4-chained Claude calls via QStash
   - `PUT /api/papers/:paperId` — Save generated paper to Redis

---

## Key CSS Variables Reference

Use these in any component:

```css
/* Colors */
--accent: #0ea5e9              (main teal/cyan)
--accent-dark: #0284c7         (darker teal)
--teal: #0ea5e9                (alias, same as --accent)
--teal2: #06b6d4               (alias, lighter teal)
--teal-bg: rgba(14, 165, 233, 0.1)   (background tint)
--teal-border: rgba(14, 165, 233, 0.3) (border color)

--red: #ef4444
--green: #22c55e
--amber: #f59e0b
--blue: #3b82f6

/* Backgrounds & Text */
--bg1: #0f172a                 (darkest, page background)
--bg2: #1e293b                 (dark grey, cards)
--bg3: #334155                 (medium grey, hover states)
--text1: #f1f5f9               (main text)
--text2: #cbd5e1               (secondary text)
--text3: #94a3b8               (muted text)

/* Layout */
--sidebar-width: 210px
--content-max-width: 960px

/* Spacing */
--spacing-xs: 0.25rem
--spacing-sm: 0.5rem
--spacing-md: 1rem
--spacing-lg: 1.5rem
--spacing-xl: 2rem
--spacing-2xl: 3rem
```

---

## Emergency Rollback

If anything breaks:

```bash
cd ~/student-mastery
git log --oneline | head -5
git revert HEAD~1  # or git checkout HEAD~1 -- src/App.jsx
git push
vercel --prod
```

---

## Notes

- **Clerk dev/test keys:** Always use `pk_test_*` in dev, `pk_live_*` in prod
- **Claude model:** Must be `claude-sonnet-4-5` (no date suffix) in API calls
- **Redis:** Ensure Upstash syd1 Redis is connected for Student Mastery
- **Vercel functions:** Keep 12-function limit in mind; use explicit listing in vercel.json
