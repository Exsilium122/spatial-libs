# Rules & Safety Constraints

Rules and invariants enforced by `om-release`.

## 1. Safety & Reversibility Rules

- **User Confirmation Required:** Never execute Step 5 (commit) or Step 6 (release publish) without explicit user sign-off. The skill must present suggested defaults and wait for confirmation.
- **Fail-Safe Gate:** If `npm test` or `npm run build` fails at Step 4, abort immediately. Never publish broken code or failing tests.
- **Atomic Rollback:** If the validation gate or git push fails, revert all modified `package.json` files using `git checkout -- packages/*/package.json package.json`.
- **Branch Protection:** Never release from a feature branch or uncommitted working tree. Releases must be cut strictly from `main`.
- **No Downgrades:** Never downgrade package versions or overwrite existing published tags on NPM.

## 2. Secrets & Credential Hygiene

- Never log or display NPM authentication tokens, GitHub tokens, or private environment variables.
- Publishing relies entirely on GitHub Actions with OIDC provenance (`--provenance`). No local npm tokens are required.

## 3. Dry-Run Mode

When invoked with `--dry-run`:
- Perform all commit analysis, package change detection, and release notes generation.
- Print the exact commands that would be executed.
- Do not modify any files on disk, do not commit, and do not call `gh release create`.
