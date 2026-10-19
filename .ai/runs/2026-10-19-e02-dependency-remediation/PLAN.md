# E02 — Dependency & Supply Chain Vulnerability Remediation

Issue: #2 (stories #9, #10, #11)
Skill: `om-orchestrate` wrapping `om-auto-fix-issue`
Lead: Claude Opus 5.5 · Subtasks: Antigravity (Gemini 3.8 Flash)

## 🎯 Goal

Bring `npm audit` from 19 vulnerabilities (3 critical, 6 high) to zero without public API changes:
- uuid override no longer pins a vulnerable version (#9)
- tester: axios patched, xml2js replaced by fast-xml-parser >= 5.8.0 (#10)
- vitest/esbuild upgraded so tinypool, vite, esbuild advisories are gone (#11)

## Baseline audit (main @ 013b025)

| Package | Severity | Path | Fix |
|---|---|---|---|
| tinypool <=2.1.1 | critical | vitest 1.x | vitest ^5 (#11) |
| proxy-addr | critical | express (dev peer) | lockfile refresh |
| axios <=1.19.0 | high | tester | axios ^1.20.0 (#10) |
| form-data, nanoid, postcss, source-map-js | high | transitive | lockfile refresh |
| esbuild <=0.28.0, vite, vite-node | moderate | root/tester devDeps, vitest | esbuild ^0.28.2, vitest ^5 (#11) |
| uuid <11.1.1 | moderate | autocannon → hyperid@3 | override `uuid: ^11.1.1` (#9) |
| qs, body-parser | moderate | express (dev peer) | lockfile refresh |
| xml2js <0.5.0 | moderate | express-xml-bodyparser@0.3 (wfs peer) | allow `^0.4.1` in wfs peer range |

Decision: the override is updated rather than removed — removing it leaves hyperid@3 on uuid@8. uuid 11 is the last CommonJS-compatible line, which hyperid@3 (CJS) needs.

## Phase 1 — Lead scaffolding

- Root `package.json`: `overrides.uuid` → `^11.1.1`, `esbuild` → `^0.28.2`.

## Phase 2 — Parallel subtasks (disjoint scopes)

| Unit | Scope | Work |
|---|---|---|
| A — tester | `packages/tester/**` | axios ^1.20, xml2js → fast-xml-parser ^5.8, esbuild ^0.28.2, vitest ^5; tests green |
| B — libs | `packages/crs/**`, `packages/ogc/**`, `packages/wfs/**` | vitest ^5; wfs peer `express-xml-bodyparser` widened to include ^0.4.1; tests green |

Children do not commit `package-lock.json`; the lead regenerates it once at integration.

## Phase 3 — Integration

- `npm install` + `npm audit fix` (non-breaking) to regenerate `package-lock.json`.
- Gate: `npm test`, `npm run build`, `npm audit` → 0 vulnerabilities.
- Final review subtask on the integrated branch.

## Progress

- [x] Phase 1 — root override + esbuild
- [x] Unit A — tester merged (9dfc0062)
- [x] Unit B — libs merged (56be55c9)
- [x] Lockfile regenerated from scratch (stale entries ignored the uuid override), audit: 0 vulnerabilities
- [x] Full gate green — npm test 55/55, npm run build ok, npm ci ok
- [x] Final review approved (4d74b672, gemini-3.8-flash-high)
- [x] PR ready
