# Agent Instructions: spatial-libs

Welcome! This file serves as the project-level entry point and instruction manual for all AI coding agents (Claude Code, Cursor, Aider, Cline, Antigravity, etc.) interacting with this codebase.

Please read and adhere to these guidelines to ensure consistency, security, and high quality.

---

## 📂 Project Architecture & Monorepo Structure

This is a TypeScript-based monorepo managed with npm workspaces:
*   **Root Configuration:** `package.json` manages workspaces (`packages/*`) and shared dev dependencies.
*   **Packages:**
    *   **[`packages/ogc`](packages/ogc):** OGC API Features standard routing and dispatching implementation.
    *   **[`packages/wfs`](packages/wfs):** Web Feature Service (WFS) protocol engine for v1.0.0, v1.1.0, and v2.0.0.

---

## 🛠️ Build & Test Commands

Always execute commands from the monorepo root:
*   **Build all packages:** `npm run build` (runs `npm run build --workspaces`)
*   **Run all tests:** `npm test` (runs `npm test --workspaces`)

Ensure that both the build and test suites pass completely without error before proposing any changes or final approvals.

---

## 🛡️ Coding Standards & Constraints

To keep the libraries secure, lightweight, and maintainable, adhere to these strict engineering constraints:

### 1. Public API Minimalism & Boundary Control
*   Internal utility methods and helpers (e.g., XML builders, parsers, input validation functions like `verifyProvider`, `parseFilterString`, `parseFilterObj`, `normalizeKeys`) **must not** be exposed in public package entrypoints (`packages/*/src/index.ts`).
*   Only expose high-level, framework-agnostic routing and request-dispatching APIs (e.g., `dispatchWfsRequest`, `handleWfs110`, `handleWfs200`).
*   Test internal behaviors indirectly by checking how routers/entrypoints handle invalid inputs rather than creating direct unit tests for internal-only functions.

### 2. Dependency Management & Security Hardening
*   **XML Parsing/Building:** Consolidated on the highly active `fast-xml-parser` (version `5.8.0` or later).
*   **Vulnerability Compliance:** Never downgrade `fast-xml-parser` below `v5.7.0` to prevent **CVE-2026-41650** (XML CDATA/Comment delimiter injection).
*   **Clean Packaging:** Ensure compiled files output only to `dist/`. All test suites, source `.ts` files, maps, and local assets must be excluded from npm publishing via the `"files": ["dist"]` filter in each package's `package.json`.

---

## 🪄 Specialized Agent Skills

We maintain specialized agent skills and automated workflows for this codebase:
*   **Release Notes & Changelog Preparer:** Follow the step-by-step instructions located at **[.github/skills/release-notes/SKILL.md](.github/skills/release-notes/SKILL.md)** whenever you are asked to draft or finalize release notes for code updates.
