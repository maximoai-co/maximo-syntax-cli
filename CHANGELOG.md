# Changelog

All notable changes to Maximo Syntax CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.13] - 2026-06-05

### Changed

- Refreshed the startup terminal UI with Maximo branding, restored the "Move at Maximo Speed" tagline, and replaced the legacy mascot with a compact octopus mascot.
- Moved "Maximo AI account with subscription" to the first login option.

### Fixed

- Fixed Maximo AI subscription logins falling back to API usage billing when OAuth token responses omit scope metadata.
- Fixed the startup billing label for Maximo subscription sessions that run through the Maximo OpenAI-compatible endpoint.
- Fixed a post-login keyboard/input freeze by keeping the startup subscription label separate from request authentication, so Maximo OpenAI-compatible sessions continue using their configured API key.
- Fixed subscription plan labels so Plus, Prime, and Pro display as their actual Maximo plans.
- Fixed Recent Sessions and `/resume` falling back to empty when only the active session exists in the current project by loading all-project sessions before showing the empty state.

## [0.1.11] - 2026-04-10

### Fixed

- `/usage` command billing display corrections
  - Fixed wallet balance showing incorrect amounts (was dividing by 100 incorrectly)
  - Fixed duplicate currency symbol rendering (`$$4.90` → `$4.90 USD`)
  - Fixed React compiler cache variable syntax errors in BillingSection component

## [0.1.10] - 2026-04-10

### Added

- **Usage Command** (`/usage`) - Comprehensive token allocation and usage tracking
  - Subscription information display (plan type, status, next payment date)
  - Token allocations with progress bars:
    - Daily allocation window
    - 5-hour rolling window
    - Weekly allocation window
  - Fair usage warnings when approaching limits
  - Billing information (wallet balance, total spent, total deposited)
  - Lifetime statistics (total requests, tokens, costs breakdown)
  - Usage by model breakdown (last 30 days)
  - Daily usage history (last 30 days)
  - Works with both authentication methods:
    - **Option 1**: API key authentication (`x-api-key` header)
    - **Option 2**: OAuth authentication (`Authorization: Bearer` header)

### Changed

- Usage command is now always visible in suggestions (removed `availability` restriction)
- Improved authentication flow to support both API key and OAuth users for usage endpoints
- Updated usage service to allow API key users to fetch usage data (previously OAuth-only)
- Better fallback messaging when no usage data is available

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 0.1.13 | 2026-06-05 | Refreshed startup UI, fixed subscription login billing/input behavior, and repaired session discovery |
| 0.1.11 | 2026-04-10 | Fixed billing display issues in `/usage` command |
| 0.1.10 | 2026-04-10 | Added comprehensive `/usage` command with dual auth support |
| 0.1.0 | 2026-03 | Initial release |

---

For a complete list of changes, see the [GitHub Releases](https://github.com/maximoai/maximo-syntax-cli/releases) page.
