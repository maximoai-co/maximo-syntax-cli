# Security Policy

## Supported Versions

Maximo Syntax CLI is currently maintained on the latest main branch and the latest npm release only.

| Version                            | Supported |
| ---------------------------------- | --------- |
| Latest release                     | ✅        |
| Older releases                     | ❌        |
| Unreleased forks / modified builds | ❌        |

Security fixes are generally released in the next patch version and may also be landed directly on main before a package release is published.

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Maximo Syntax CLI, please report it privately.

**Preferred reporting channel:**

- GitHub Security Advisories / private vulnerability reporting for the [maximoai/maximo-syntax-cli](https://github.com/maximoai-co/maximo-syntax-cli) repository

**Please include:**

- A clear description of the issue
- Affected version, commit, or environment
- Reproduction steps or a proof of concept
- Impact assessment
- Any suggested remediation, if available

Please do not open a public issue for an unpatched vulnerability.

## Response Process

Our general goals are:

- Initial triage acknowledgment within 7 days
- Follow-up after validation when we can reproduce the issue
- Coordinated disclosure after a fix is available

Severity, exploitability, and maintenance bandwidth may affect timelines.

## Disclosure and CVEs

Valid reports may be fixed privately first and disclosed after a patch is available.

If a report is accepted and the issue is significant enough to warrant formal tracking, we may publish a GitHub Security Advisory and request or assign a CVE through the appropriate channel. CVE issuance is not guaranteed for every report.

## Scope

This policy applies to:

- The Maximo Syntax CLI source code in this repository
- Official release artifacts published from this repository
- The `@maximoai/maximo-syntax-cli` npm package

This policy does not cover:

- Third-party model providers, endpoints, or hosted services
- Local misconfiguration on the reporter's machine
- Vulnerabilities in unofficial forks, mirrors, or downstream repackages
