# E04 — Spatial Protocol Integrity & Error Handling

Issue: #4 (stories #15, #16, #17)
Branch: `fix/e04-protocol-integrity`
Mode: `om-orchestrate` wrapping `om-auto-fix-issue` — lead plans/merges, children (antigravity / `gemini-3.8-flash-high`) implement.

## Triage (om-verify-in-repo)

All three defects reproduce on `main` @ 013b025:

- #15 — `packages/ogc/src/index.ts:354` gates the BBOX filter on `options.crsTransformer`, so native WGS84 routers silently drop `?bbox=`.
- #16 — `packages/crs/src/index.ts:258` only recognises `coords.length === 2` positions; `[x, y, z]` is mapped element-wise and returned unprojected.
- #17 — `packages/wfs/src/v1_0_0.ts:400`, `v1_1_0.ts:501`, `v2_0_0.ts:538` echo `err.message` into the XML ExceptionReport.

## Decomposition

The three stories touch disjoint packages and share no interface change
(the public `transformCoordinate` 2D signature is kept; Z handling lives inside `transformGeometry`).

| Unit | Story | Scope |
|---|---|---|
| A | #15 BBOX without crsTransformer | `packages/ogc/**` |
| B | #16 3D coordinates in CrsTransformer | `packages/crs/**` |
| C | #17 Sanitized WFS exception XML | `packages/wfs/**` |

## Progress

### Phase 1 — Parallel fixes
- [ ] 1.1 Unit A — OGC native BBOX filtering (#15)
- [ ] 1.2 Unit B — CRS 3D coordinate reprojection (#16)
- [ ] 1.3 Unit C — WFS exception sanitization (#17)

### Phase 2 — Integration
- [ ] 2.1 Full gate (`npm test`, `npm run build`) on merged branch
- [ ] 2.2 Independent review task verdict = approve
- [ ] 2.3 PR ready
