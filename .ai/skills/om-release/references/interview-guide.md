# Interview Guide & Sensible Defaults

How `om-release` analyzes changes, prepares recommended defaults, and conducts the interactive user confirmation in Steps 2 & 3.

## 1. Deriving Sensible Defaults

When analyzing commits since the last tag:
1. **Find latest tag and commits:**
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0)
   git log ${LAST_TAG}..HEAD --oneline
   ```
2. **Detect changed packages:**
   Inspect diff against each workspace directory under `packages/`:
   ```bash
   git diff ${LAST_TAG}..HEAD --name-only packages/crs
   git diff ${LAST_TAG}..HEAD --name-only packages/ogc
   git diff ${LAST_TAG}..HEAD --name-only packages/wfs
   git diff ${LAST_TAG}..HEAD --name-only packages/tester
   ```
3. **Determine SemVer bump type:**
   - **Breaking (`major`):** Commits containing `BREAKING CHANGE:` or `!:` (e.g., `feat!:`) → bump Major (e.g. `1.1.2` → `2.0.0`).
   - **Feature (`minor`):** Commits containing `feat:` → bump Minor (e.g. `1.1.2` → `1.2.0`).
   - **Fix/Chore (`patch`):** Only `fix:`, `chore:`, `refactor:`, `docs:` → bump Patch (e.g. `1.1.2` → `1.1.3`).
4. **Draft Release Notes:**
   Apply `.github/skills/release-notes/SKILL.md` categorization:
   - 🚀 **Features:** New capabilities or API endpoints
   - 🛡️ **Security & Bug Fixes:** Fixes, error sanitization, security patches
   - 🔧 **Refactoring & Optimization:** Internal cleanups, performance improvements
   - 📦 **Chores & Dependencies:** Maintenance, build, lockfile updates

## 2. Presenting the Interview to the User

Present the prepared plan clearly and concisely, highlighting the detected facts and the recommended choices:

```markdown
### 📦 Release Proposal

- **Base Tag:** `v1.1.2`
- **Commits since tag:** 4 commits
- **Modified packages:**
  - `@spatial-api/ogc` (`1.1.2` → `1.2.0` recommended: minor feature added)
  - `@spatial-api/crs-transformer` (`1.1.2` → `1.2.0` recommended: 3D coordinates support)
- **Unmodified packages:** `@spatial-api/wfs`, `@spatial-api/tester` (keep unchanged)
- **Target Tag:** `v1.2.0`
- **Release Title:** `v1.2.0: Spatial Protocol Integrity & Error Handling`

#### 📝 Draft Highlights:
- **🚀 Features:** Native WGS84 BBOX filtering and 3D coordinate reprojection.
- **🛡️ Security:** Exception sanitization in WFS XML errors.
```

## 3. Interview Options & Structured Question

Ask the user for confirmation using structured interactive options (`CEZ:ASK` or interactive prompt) with the recommended action listed first:

1. **Option 1 (Recommended): Approve defaults** — "Proceed with recommended version bumps (v1.2.0) and draft notes."
2. **Option 2: Adjust versions** — "Change version bump type (e.g. use patch v1.1.3 or coordinate all packages)."
3. **Option 3: Edit release notes** — "Customize release title and highlights before publishing."
4. **Option 4: Abort release** — "Cancel release without making changes."

If the user approves the defaults, proceed immediately to the validation gate and publishing steps.
