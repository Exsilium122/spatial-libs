# @spatial-api/tester

A dynamic, production-ready, zero-installation spatial test and benchmarking CLI suite (`spatial-tester`) for WFS (v1.0.0, v1.1.0, v2.0.0) and OGC API - Features.

---

## 🛠️ Key Features

1. **Zero-Installation Execution**: Easily run the tester from any terminal via `npx` without needing any pre-installed packages or local configurations on the target server.
2. **Auto-Probing Target Discovery**: Provide a base URL, and the tool will automatically probe common paths (like `/api/wfs`, `/api/ogc`, `/wfs`, `/ogc`, etc.) to auto-discover active endpoints.
3. **Dynamic Capabilities Parser**: Downloads and processes Capabilities XML and JSON collections metadata on the fly to detect available layers (e.g., `trees`, `lakes`, `bushes`, `campings`) and their individual coordinate reference systems (SRS list like `EPSG:4326`, `EPSG:3857`).
4. **Interactive Configuration Prompts**: Use arrow keys and spacebars to dynamically choose spatial collections, per-collection target protocols, projections, and benchmarking parameters.
5. **Parallel Multithreaded Stress Benchmarks**: Simulate concurrent high-speed requests targeting WFS and OGC collections concurrently using programmatic `autocannon` routines.
6. **Aggregate Console Performance Dashboard**: Renders premium ASCII tables summarizing Latency averages, Requests Per Second (RPS), total data throughput, and error responses.
7. **Full Pipeline Automation**: Support for declarative command-line arguments (e.g. `--collections="..."`) allows immediate execution inside automated CI/CD environments.

---

## 🚀 Execution Guide

### 1. Zero-Config Interactive Mode

Run the tool passing only the target URL and optional credentials. It will probe the server and guide you through an interactive checklist:

```bash
npx @spatial-api/tester http://localhost:9002 --user="tester" --pass="secret"
```

#### Step-by-Step Flow:
* **Auto-Probing**: Finds WFS and OGC Feature endpoints and prints summary status.
* **Collection Selection**: Asks you to select from the discovered layers list:
  ```text
  ? Select the spatial collections to target:
    > [x] trees (Available on: WFS, OGC)
      [x] lakes (Available on: WFS, OGC)
      [ ] bushes (Available on: WFS)
  ```
* **Granular Configuration**: Prompts you to configure protocol options and projections *individually for each selected collection* based on what the server supports.
* **Select Test Mode**: Choose whether to run semantic **Smoke / Integration tests** or high-speed **Performance / Stress tests**.

---

### 2. Scriptable Automated Modes

For test automation or CI/CD pipelines, specify options directly in the terminal command:

#### Run Integration / Smoke Tests
Validates XML schema configurations, landing page definitions, conformance lists, GML formats, and GeoJSON structures for all active layers:
```bash
npx @spatial-api/tester http://localhost:9002 \
  --user="tester" --pass="secret" \
  --mode=smoke
```

#### Run Parallel Stress Benchmarks
Simulate high-concurrency requests simultaneously against both WFS and OGC protocols:
```bash
npx @spatial-api/tester http://localhost:9002 \
  --user="tester" --pass="secret" \
  --mode=stress \
  --collections="trees:ogc,wfs2.0.0:EPSG:4326;lakes:ogc:EPSG:3857" \
  --duration=15 \
  --concurrency=10
```
*(Specifying `--collections` in the format `name:protocols:srs;name2:protocols:srs` bypasses all interactive steps for hands-off pipeline automation).*

---

## 📊 Sample Stress Test Performance Report

```text
================================================================================
                     SPATIAL TESTER CONCURRENT LOAD REPORT
================================================================================
Target URL: http://localhost:9002
Duration:   10 seconds
Concurrent Workers: 10 per endpoint

┌───────────────────────────┬────────────┬─────────────┬─────────────┬─────────────┐
│ Target (Endpoint)         │ Req/Sec    │ Avg Latency │ Max Latency │ Errors      │
├───────────────────────────┼────────────┼─────────────┼─────────────┼─────────────┤
│ OGC - trees (EPSG:4326)   │      120.5 │     12.1 ms │     54.0 ms │           0 │
│ WFS2.0.0 - trees (EPSG:43  │       85.2 │     18.4 ms │     72.0 ms │           0 │
│ OGC - lakes (EPSG:3857)   │      110.0 │     14.5 ms │     60.0 ms │           0 │
│ WFS2.0.0 - lakes (EPSG:38  │       78.1 │     20.2 ms │     85.0 ms │           0 │
├───────────────────────────┼────────────┼─────────────┼─────────────┼─────────────┤
│ TOTAL AGGREGATE LOAD      │      393.8 │     15.8 ms │     85.0 ms │           0 │
└───────────────────────────┴────────────┴─────────────┴─────────────┴─────────────┘

Total requests handled by target: 3,938 requests
Total throughput achieved:       8.42 MB/sec (84.2 MB read)
✔ All targets completed successfully with 0 errors!
================================================================================
```

---

## 🔗 Links and Sibling Packages
*   **WFS Core Package**: [@spatial-api/wfs](https://www.npmjs.com/package/@spatial-api/wfs) — Traditional XML-based Web Feature Service engine (v1.0.0, v1.1.0, v2.0.0, v2.0.2).
*   **OGC Core Package**: [@spatial-api/ogc](https://www.npmjs.com/package/@spatial-api/ogc) — Modern JSON/GeoJSON RESTful API Features Part 1 & Part 2 protocol engine.
*   **CRS Transformer Package**: [@spatial-api/crs-transformer](https://www.npmjs.com/package/@spatial-api/crs-transformer) — Dynamic Coordinate Reference System transformations and administrative synonyms registry using Proj4.
*   **Monorepo GitHub**: [https://github.com/Exsilium122/spatial-libs](https://github.com/Exsilium122/spatial-libs)
