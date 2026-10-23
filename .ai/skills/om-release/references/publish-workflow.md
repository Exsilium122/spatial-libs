# Publishing & Verification Workflow

How `om-release` executes the validation gate, creates GitHub Releases, and verifies NPM publishing.

## 1. Validation Gate

Before creating any git commit or tag, run the full validation gate:
```bash
npm test
npm run build
```
- Both commands must exit with code `0`.
- If any test fails or compilation errors occur, halt the release immediately. Report the error output to the user and revert any unstaged `package.json` changes.

## 2. Creating the GitHub Release

Once the version bump commit has been pushed to `main`:
1. Prepare the release notes text or save it to a temporary file (e.g. `.ai/tmp/release-notes.md`).
2. Run `gh release create`:
   ```bash
   gh release create v<Version> \
     --title "v<Version>: <Release Title>" \
     --notes "<Release Notes Body>" \
     --target main
   ```
   *(or use `--notes-file <path>`)*

## 3. Monitoring NPM Publishing Workflow

Creating the GitHub release triggers `.github/workflows/publish.yml`:
1. Check the newly triggered workflow run:
   ```bash
   gh run list --workflow=publish.yml --limit 3
   ```
2. Watch the workflow until completion:
   ```bash
   gh run watch <RUN_ID>
   ```
3. Ensure all jobs succeed (`conclusion: success`).

## 4. NPM Registry Verification

Verify that the bumped packages are publicly accessible on the NPM registry:
```bash
npm view @spatial-api/crs-transformer@<Version> version
npm view @spatial-api/ogc@<Version> version
npm view @spatial-api/wfs@<Version> version
npm view @spatial-api/tester@<Version> version
```

## 5. Post-Release Summary

Report the release outcome with:
- Release tag and GitHub release URL: `https://github.com/Exsilium122/spatial-libs/releases/tag/v<Version>`
- Published package versions on NPM
- Link to the passing GitHub Actions publish run
