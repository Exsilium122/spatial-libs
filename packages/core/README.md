# @spatial-api/core

Core data contract, shared types, filter tree, error hierarchy, provider validation, and logging for the `@spatial-api` ecosystem.

## Overview

`@spatial-api/core` defines the standard, capability-based `SpatialProvider` interface used by all spatial protocol engines (such as `@spatial-api/wfs` and `@spatial-api/ogc`).

## Installation

```bash
npm install @spatial-api/core
```

## Exports

- `.`: Public contract types (`SpatialProvider`, `Feature`, `CollectionDescription`, etc.), error classes (`ProviderError`, `NotFoundError`, etc.), `validateProvider`, and logging utilities (`createConsoleLogger`, `normalizeLogger`).
- `./conformance`: Conformance test kit and validation helpers for provider implementations.
- `./internal`: Sibling-package internal utilities (e.g. shared filter validation and query pipelines). Marked `@internal`, excluded from semver stability guarantees, and not intended for direct consumer use.

## License

MIT
