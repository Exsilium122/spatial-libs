# Security Policy

## Supported Versions

The following table lists which releases of `spatial-libs` packages (`@spatial-api/ogc` and `@spatial-api/wfs`) are currently supported with security updates.

| Package | Version | Supported |
| --- | --- | --- |
| `@spatial-api/ogc` | `1.2.x` | :white_check_mark: |
| `@spatial-api/ogc` | `< 1.2.0` | :x: |
| `@spatial-api/wfs` | `1.2.x` | :white_check_mark: |
| `@spatial-api/wfs` | `< 1.2.0` | :x: |

---

## Reporting a Vulnerability

We take the security of `spatial-libs` seriously. If you discover a vulnerability or potential security flaw, please report it responsibly so we can remediate it before public disclosure.

### Preferred Method: GitHub Private Vulnerability Reporting

Please report security issues directly using GitHub's Private Vulnerability Reporting channel:

1. Navigate to the repository's [Security Advisories tab](https://github.com/Exsilium122/spatial-libs/security/advisories).
2. Click **"Report a vulnerability"** to submit a draft security advisory.
3. Provide as much relevant detail as possible:
   - Affected package(s) and version(s).
   - A clear description of the vulnerability and its potential impact.
   - Proof of Concept (PoC) or reproduction steps.
   - Any suggested remediations or mitigations.

Using GitHub Private Vulnerability Reporting allows maintainers to collaborate with you privately in a dedicated advisory workspace, verify the fix, and coordinate release and CVE publication safely.

---

## Response Timeline & Disclosure Process

- **Acknowledgement:** We aim to acknowledge receipt of security reports within **48 hours**.
- **Assessment:** We will triage the report, confirm the vulnerability, and assess its severity (CVSS / OWASP classification).
- **Remediation:** We will develop and verify a fix. If needed, you may be invited to collaborate directly on the private advisory workspace.
- **Coordinated Disclosure:** Once a patch is prepared and published to npm (`@spatial-api/*`), the security advisory and release notes will be published publicly with credit to the reporter (unless you prefer anonymity).

Please **do not** open public GitHub issues or pull requests detailing undisclosed security vulnerabilities.
