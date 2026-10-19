# Unit C — WFS trusted base URL (#7 WFS part, decision D04)

## Context
`createWfsRouter` in `packages/wfs/src/index.ts` builds
`genericReq.baseUrl = \`${req.protocol}://${req.get('host')}${req.baseUrl}\``
from the raw `Host` header. The version handlers (`v1_0_0.ts`, `v1_1_0.ts`, `v2_0_0.ts` — **not in your scope, do not edit them**) compute
`activeBaseUrl = (options.baseUrl.startsWith('http') || !req.baseUrl) ? options.baseUrl : req.baseUrl`
and embed it in GetCapabilities OnlineResource / DCP URLs. A poisoned `Host` header therefore ends up in cached capabilities documents (cache poisoning / phishing).

## Required changes
1. `packages/wfs/src/types.ts`: add to `WfsOptions`
   ```ts
   /** Allowed Host header values (e.g. ['api.example.com', 'localhost:3000']), compared case-insensitively.
    *  Only used when `baseUrl` is not absolute. */
   trustedHosts?: string[];
   ```
2. `packages/wfs/src/index.ts`, in `createWfsRouter`'s request handler, resolve `genericReq.baseUrl` with an internal (non-exported) helper:
   1. `options.baseUrl` absolute (`http://` / `https://`) → set `genericReq.baseUrl` to `options.baseUrl` (Host ignored).
   2. Otherwise take `req.get('host')`; usable only if it matches `/^[a-zA-Z0-9.-]+(:\d{1,5})?$/` (or a bracketed IPv6 literal like `[::1]:3000`) **and**, when `trustedHosts` is set, is in the allowlist (case-insensitive). Usable → `${req.protocol}://${host}${req.baseUrl}`.
   3. Not usable → set `genericReq.baseUrl` to `undefined` so handlers fall back to the configured (relative) `options.baseUrl`. Never reflect the untrusted host.
3. At router creation: if `options.baseUrl` is relative and `trustedHosts` is not set, emit one `options.logger?.warn(...)` recommending an absolute `baseUrl` or `trustedHosts`.
4. Do not export the helper from the package entrypoint (AGENTS.md: public API minimalism). `dispatchWfsRequest` behaviour is unchanged.
5. `packages/wfs/README.md`: document `trustedHosts` and the resolution rules above (short section, e.g. under configuration / security).

## Tests
Create `packages/wfs/test/host-security.test.ts` (vitest; use express + supertest like the existing `packages/wfs/test/wfs.test.ts` if available, otherwise call the router through a minimal express app). Mock provider as in `wfs.test.ts`. Cover:
- Absolute `baseUrl: 'https://api.example.com/wfs'` + `Host: attacker.com` → GetCapabilities body contains `https://api.example.com/wfs` and never `attacker.com`.
- Relative `baseUrl: '/wfs'` + `trustedHosts: ['api.example.com']` + `Host: attacker.com` → body never contains `attacker.com`; `Host: api.example.com` → body contains `http://api.example.com`.
- Relative `baseUrl` without `trustedHosts` + malformed host (`evil.com/x`, `a@b.com`) → not reflected.
- Warning is logged once when relative baseUrl and no `trustedHosts`.
Run for at least versions 1.1.0 and 2.0.0 GetCapabilities.

## Scope (edit ONLY these)
`packages/wfs/src/index.ts`, `packages/wfs/src/types.ts`, `packages/wfs/README.md`, `packages/wfs/test/host-security.test.ts`.
Do NOT edit `packages/wfs/src/filterParser.ts`, `v1_0_0.ts`, `v1_1_0.ts`, `v2_0_0.ts`, `packages/wfs/test/wfs.test.ts`, package.json or lockfiles — a sibling task owns them.

## Done when
`npm test` and `npm run build` pass from repo root; work committed on your branch (`fix(wfs): …`); not pushed.
