# E05-S01 — Core scaffold: contract types, errors, validateProvider, logger, next-tag publish gating

Goal: Scaffold `@spatial-api/core` (Spec 1 Phase 1, steps 1–4) and gate prereleases to the npm `next` tag in `publish.yml`.
Scope: `packages/core`, root `package.json`, `scripts/check-dist.mjs`, `.github/workflows/publish.yml`, `AGENTS.md`.
Source doc: `.ai/specs/2026-10-20-spatial-api-2-provider-contract.md`

## Implementation Plan

### Phase 1 — Package structure & build setup
- Step 1: Create `packages/core` directory structure (`src`, `src/conformance`, `src/internal`, `test`).
- Step 2: Configure `packages/core/package.json` with dual ESM/CJS build, `"files": ["dist"]`, exports `.`, `./conformance`, `./internal`, and `packages/core/tsconfig.json`.
- Step 3: Add `packages/core` to workspace order in root `package.json`.
- Step 4: Add `packages/core` to `scripts/check-dist.mjs` with smoke tests and verification of `.`, `./conformance`, `./internal`.
- Step 5: Update `.github/workflows/publish.yml` with `core` published first and `--tag next` for prereleases (versions containing `-`).

### Phase 2 — Contract types & Errors
- Step 6: Create `packages/core/src/types.ts` containing all protocol-neutral contract types: `Geometry`, `Feature`, `CollectionDescription`, `PropertySchema`, `ProviderCapabilities`, `Filter`, `FilterOperator`, `RequestContext`, `GetFeaturesParams`, `FeatureResult`, `WriteOperation`, `TransactionResult`, `SpatialProvider`, `FeatureEncoder`, `CoordinateTransformer`, `SpatialRequest`, `SpatialResponse`, `SpatialService`, `ServiceInfo`, `ServiceLimits`.
- Step 7: Create `packages/core/src/errors.ts` containing `ProviderError` base class (with `clientSafe`, `locator`, `statusCode`, `toJSON`), 6 typed subclasses (`NotFoundError`, `InvalidParameterError`, `NotSupportedError`, `ConflictError`, `ForbiddenError`, `UnavailableError`), and `ProviderContractError` (with `violations` list).
- Step 8: Create unit & type tests for types and errors in `packages/core/test/types.test.ts` and `packages/core/test/errors.test.ts`.

### Phase 3 — Validation & Logger
- Step 9: Create `packages/core/src/validate.ts` with `validateProvider(provider, requirements)` collecting all violations into `ProviderContractError`.
- Step 10: Create `packages/core/src/logger.ts` with `createConsoleLogger(prefix)` and `normalizeLogger(logger?: Logger | false)`.
- Step 11: Create `packages/core/src/index.ts`, `packages/core/src/conformance/index.ts`, `packages/core/src/internal/index.ts`.
- Step 12: Create unit tests for `validateProvider` in `packages/core/test/validate.test.ts` and `createConsoleLogger`/`normalizeLogger` in `packages/core/test/logger.test.ts`.

### Phase 4 — Build, Packaging Verification & Prerelease Dry-Run
- Step 13: Build all packages with `npm run build`.
- Step 14: Run test suite with `npm test`.
- Step 15: Run `npm run test:dist` (`scripts/check-dist.mjs`).
- Step 16: Verify prerelease publish dry-run with `--tag next`.

## Risks & Mitigations

- **Packaging compliance**: `check-dist.mjs` verifies that only `dist/` is packed and all subpath exports resolve in both ESM and CJS.
- **Breaking changes**: `@spatial-api/core` is a net-new package; existing packages (`wfs`, `ogc`, `crs`) are untouched until later phases.
- **Accidental `latest` release**: `publish.yml` inspects `$VERSION` for `-` and unconditionally tags prereleases as `next`.

## Progress
- [x] Phase 1: Package structure & build setup
  - [x] Step 1: Create `packages/core` directory structure
  - [x] Step 2: Configure `packages/core/package.json` and `tsconfig.json`
  - [x] Step 3: Add `packages/core` to workspace order in root `package.json`
  - [x] Step 4: Update `scripts/check-dist.mjs` for core and its exports
  - [x] Step 5: Update `.github/workflows/publish.yml` for core and next tag
- [x] Phase 2: Contract types & Errors
  - [x] Step 6: Create `packages/core/src/types.ts`
  - [x] Step 7: Create `packages/core/src/errors.ts`
  - [x] Step 8: Add types and errors test suites
- [x] Phase 3: Validation & Logger
  - [x] Step 9: Create `packages/core/src/validate.ts`
  - [x] Step 10: Create `packages/core/src/logger.ts`
  - [x] Step 11: Create `packages/core/src/index.ts`, conformance and internal entrypoints
  - [x] Step 12: Add validation and logger test suites
- [x] Phase 4: Build, Packaging Verification & Prerelease Dry-Run
  - [x] Step 13: Build packages
  - [x] Step 14: Run test suites
  - [x] Step 15: Run check-dist packaging check
  - [x] Step 16: Verify prerelease publish dry-run
