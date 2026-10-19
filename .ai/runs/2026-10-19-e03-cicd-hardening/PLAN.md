# E03 — DevOps & CI/CD Pipeline Hardening

Issue: #3 (stories #12, #13, #14)
Orchestrator: om-orchestrate → om-auto-fix-issue (feature route, no spec — stories carry acceptance criteria)

## Goal

PRs and pushes to main are validated by CI (build + test across all workspaces), releases cannot
publish without passing tests, all GitHub Actions are pinned to commit SHAs, and the tester CLI
package has a real Vitest suite.

## Phase 1 — parallel units (disjoint scopes)

| Unit | Stories | Scope | Runner / model |
|---|---|---|---|
| A — Workflows | #12, #13 | `.github/workflows/**` | antigravity / gemini-3.8-flash-high |
| B — Tester tests | #14 | `packages/tester/**`, `package-lock.json` | antigravity / gemini-3.8-flash-high |

Pinned action SHAs (resolved by the lead from the GitHub API, staying on the v5 major already in use):
- `actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0`
- `actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0`

## Phase 2 — integration

Merge A and B, then run the full gate (`npm test`, `npm run build`) and get a final review subtask's verdict.

## Progress

- [ ] Unit A — ci.yml + gated, pinned publish.yml
- [ ] Unit B — tester Vitest suite
- [ ] Integration gate green
- [ ] Final review approved
- [ ] PR ready
