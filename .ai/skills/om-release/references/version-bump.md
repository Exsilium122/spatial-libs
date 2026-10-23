# Version Bumping & Monorepo State

How `om-release` updates package versions and commits release changes.

## 1. Inspecting Monorepo Workspaces

The repository has 4 npm workspace packages under `packages/`:
- `packages/crs` (`@spatial-api/crs-transformer`)
- `packages/ogc` (`@spatial-api/ogc`)
- `packages/wfs` (`@spatial-api/wfs`)
- `packages/tester` (`@spatial-api/tester`)

Read the current versions:
```bash
node -e "['crs','ogc','tester','wfs'].forEach(p => console.log(p, require('./packages/' + p + '/package.json').version))"
```

## 2. Updating Package Versions

Once the user approves the target versions:
1. Update each modified package's `package.json`:
   - Replace `"version": "x.y.z"` with the approved new version.
2. If all packages are being coordinated or root version is tracked, update root `package.json`:
   - Set `"version": "x.y.z"`.
3. If internal dependencies exist between packages (e.g. `tester` depending on `ogc` or `wfs`), verify if dependency version ranges require updating.

## 3. Rebuilding & Checking Clean Compilation

After updating `package.json`, build the packages to verify TypeScript types and dist outputs match:
```bash
npm run build
```

## 4. Committing Version Bumps

Stage the updated `package.json` files and commit with a standard conventional release commit:
```bash
git add packages/*/package.json package.json
git commit -m "chore(release): bump package versions for v<Version>"
git push origin main
```

> [!IMPORTANT]
> Never commit version bumps if tests or builds failed during the validation gate.
