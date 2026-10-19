# Unit A — WFS filter injection + prototype pollution hardening (#5 WFS part, #8)

## Context
`packages/wfs/src/filterParser.ts` turns user-supplied OGC Filter XML into MongoDB query objects. Today:
1. `PropertyName` values like `$where` / `$expr` / `__proto__` are used verbatim as Mongo keys (NoSQL operator injection).
2. `Literal` values may be objects, not primitives.
3. `PropertyIsLike` builds a RegExp where consecutive wildcards produce `.*.*.*` (catastrophic backtracking / ReDoS); literal length is unbounded.
4. `normalizeKeys()` assigns stripped keys onto a plain `{}`, so `<__proto__>` / `<constructor>` / `<prototype>` elements can pollute prototypes.

The parser is called from `packages/wfs/src/v1_0_0.ts`, `v1_1_0.ts`, `v2_0_0.ts` (GET `FILTER` param via `parseFilterString`, POST body via `normalizeKeys` + `parseFilterObj`, BBOX `PropertyName`).

## Required changes
A. **Property-name validator** (internal to `filterParser.ts`, never exported from `packages/wfs/src/index.ts`): must be a string matching `/^[a-zA-Z0-9_.-]+$/`, must not start with `$`, and no dot-separated segment may equal `__proto__`, `constructor`, `prototype`. Apply to every `PropertyName` (all comparison ops, `PropertyIsLike`, `BBOX`). On violation throw a dedicated internal error class (e.g. `class FilterValidationError extends Error`, `name = 'FilterValidationError'`).
B. **Literals**: after `unwrap`, accept only string/number/boolean; anything else → throw the same error. A missing literal keeps current behaviour.
C. **PropertyIsLike**: reject literals longer than 256 chars (throw), escape all regex metacharacters, collapse runs of consecutive wildcards (`*` or `%`) into one before converting to `.*`, keep anchored `^…$` case-insensitive. Normal patterns like `Oak*` must keep working.
D. **normalizeKeys**: build results with `Object.create(null)` and skip keys (after namespace stripping) equal to `__proto__`, `constructor`, `prototype`. Keep: arrays mapped, `@`-prefixed and `$` keys skipped as now, non-object/null input returned unchanged, namespace stripping (`fes:Filter` → `Filter`). Query objects built in `parseFilterObj` must be safe too — the validator guaranteeing safe keys is enough; the returned query must still behave like a normal object (Object.keys / spread / JSON.stringify / vitest `toEqual` in existing tests). If `Object.create(null)` in normalizeKeys breaks existing `toEqual` assertions, adjust so existing tests stay green without weakening the guard.
E. **Handlers** (`v1_0_0.ts`, `v1_1_0.ts`, `v2_0_0.ts`): catch `FilterValidationError` (instanceof or `err.name`) and return an OGC exception with exceptionCode `InvalidParameterValue`, locator `filter`, HTTP status **400**, instead of the generic `Internal WFS Processing Error`. Use the existing `buildExceptionResponse` helpers in those files. Change nothing else.
F. **Tests**: create `packages/wfs/test/filter-security.test.ts` (vitest). Per AGENTS.md, test through public entrypoints (`dispatchWfsRequest` / `handleWfs110` / `handleWfs200` from `packages/wfs/src/index.ts`) with a mock provider recording the `filterQuery` it receives — do NOT import `filterParser.ts` directly. See `packages/wfs/test/wfs.test.ts` for how requests/providers are mocked (GET query keys are UPPERCASE: `FILTER`, `TYPENAMES`, `REQUEST`, `SERVICE`, `VERSION`). Cover:
   - GET FILTER with `<PropertyName>$where</PropertyName>` → 400 exception, `getFeatures` never called; same for `$expr`; same for `a.__proto__.b`.
   - POST body containing `__proto__` / `constructor` elements → `({} as any).polluted` stays undefined; `Object.prototype` untouched.
   - Object literal (nested element inside `<Literal>`) → 400.
   - Valid names `name`, `props.height_m`, `tree-type` still filter normally (provider receives the expected query).
   - `PropertyIsLike` with `Oak*` still yields a matching regex; a pathological literal (e.g. `'*a'.repeat(100)`) completes fast (< 100 ms) and a >256-char literal → 400.

## Scope (edit ONLY these)
`packages/wfs/src/filterParser.ts`, `packages/wfs/src/v1_0_0.ts`, `packages/wfs/src/v1_1_0.ts`, `packages/wfs/src/v2_0_0.ts`, `packages/wfs/test/filter-security.test.ts`.
Do NOT edit `packages/wfs/src/index.ts`, `packages/wfs/src/types.ts`, `packages/wfs/test/wfs.test.ts`, READMEs, package.json or lockfiles — sibling tasks own those.

## Done when
`npm test` and `npm run build` pass from repo root; work committed on your branch (`fix(wfs): …`); not pushed.
