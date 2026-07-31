# Changelog

All notable changes to Maximo Syntax CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.19] - 2026-07-31

### Fixed

- **Auto-mode classifier stage 2 "unparseable" blocks**: the two-stage XML classifier now returns its verdict through the structured `classify_result` tool call (guaranteed JSON) instead of relying on a free-text `<block>` tag. Stage-2 responses that contained reasoning or trailing text — or had the verdict cut off by server-side adaptive thinking — previously failed the text parser and defaulted to `shouldBlock: true` for every action. The XML tag parser remains as a fallback, and a genuinely missing verdict still fails closed.
- **XML verdict parsing is now whitespace-tolerant**: `<block> yes</block>`, `<block>\nno\n</block>`, and truncated tags parse correctly, while lookalikes like `<block>nope</block>` still do not match (fail closed).
- **Classifier prompt no longer self-contradicts**: the output-format instruction previously required the response to begin with `<block>` while the stage-2 suffix simultaneously required `<thinking>` first — the instruction is now strict, non-contradictory, and explicitly states the transcript is not part of the response.
- **Token headroom for external classifier calls**: auto-mode classifier calls for Maximo AI / MyTabulon logins now pad `max_tokens` so server-enforced adaptive thinking cannot exhaust the budget before the verdict is emitted.

## [0.1.18] - 2026-07-31

### Added

- **Permission modes: auto (classifier) and always-approve (YOLO)**
  - Classifier **auto mode**: many tool calls are approved or blocked by a side-query safety classifier so interactive work needs fewer manual prompts. Available when logged in via **Maximo AI** or **MyTabulon**.
  - **Always-approve** (no classifier): full no-prompt mode for sandboxed/trusted environments; deny rules and hooks still apply.
  - TUI **`/auto`** picker to choose **Auto · classifier**, **Always-approve · no classifier**, or **Off** (restore default prompts). Aliases: `/yolo`, `/always-approve`, `/bypass-permissions`.
  - CLI flags: `--always-approve`, `--yolo` (aliases for `--dangerously-skip-permissions`); `--permission-mode auto` and `--enable-auto-mode` for classifier auto.
  - Classifier uses the **active selected model** and the same Maximo AI / MyTabulon login credentials (`sideQuery`). Optional override: `MAXIMO_AUTO_MODE_MODEL` / `MAXIMO_SYNTAX_AUTO_MODE_MODEL`.
  - Opt-in dialogs with clear **usage-pool warning** for classifier auto (extra API calls) and sandbox warning for always-approve.
  - TUI visibility: prompt footer shows the active mode (`◎ auto · classifier on` vs `⚠ always-approve · no classifier on`); Shift+Tab cycle toast; `/status` lists permission mode.
  - Build flag `TRANSCRIPT_CLASSIFIER` enabled for the open build (via Bun `features`), with Maximo-owned classifier system/permission prompt assets.
  - README section documenting permission modes, activation, and safety notes.

### Changed

- Expanded **read-only Bash allowlist** so routine version/help checks auto-allow under auto mode without a classifier call (e.g. `node -v`, `bun -v`, `npm -v`, and safe compounds like `node -v || bun -v || npm -v`), while still blocking dangerous suffixes such as `node -v --run …`.
- Auto-mode denial and system guidance now tell the agent to prefer dedicated tools (Read/Write/Edit/Grep/Glob) when Bash is blocked, instead of retrying the same shell command.
- Auto mode feature gate defaults to **opt-in** when remote GrowthBook config is absent, so open builds can enable auto after consent without a remote kill-switch defaulting everything off.

### Fixed

- **Web search routing**: the Maximo AI backend web-search endpoint is served at `/v1/api/web-search` (mounted at `/v1/api` in `run.js`) to bypass the globally-guarded `/api` prefix that returned 403. `WebSearchTool` now targets `/v1/api/web-search` for `api.maximoai.co` (MyTabulon's `/v1/web-search` unchanged).

### Fixed

- **Grep / ripgrep**: when the bundled `dist/vendor/ripgrep/…` binary is missing, the CLI falls back to system `rg` on `PATH`, then to a pure-JavaScript content search so Grep works on open builds without a vendored binary.
- Classifier auto mode model support is no longer limited to Claude model ID allowlists for Maximo/MyTabulon sessions; any selected model on an eligible login can drive the classifier.

## [0.1.17] - 2026-07-31

### Changed

- Web search no longer depends on the model provider's server-side search. `WebSearchTool` now calls the Maximo AI backend's Pandora (Exa-backed) web search endpoint over the API, routed by host: `/api/web-search` for `api.maximoai.co` and `/v1/web-search` for `api.mytabulon.com`.
- Web search is now available for both Maximo AI and MyTabulon logins. The Syntax AI controls search parameters (result count, type, content depth, domain filters) end-to-end via the backend.

### Fixed

- Web search is enabled only when a Maximo-issued credential is present, so pure Cencori logins no longer trigger broken provider searches.

## [0.1.16] - 2026-07-30

### Added

- Added Cencori as a login option. Users can connect with a Cencori API key (`csk_...`); it is OpenAI-compatible and routes through the existing OpenAI shim (`https://api.cencori.com/v1`).
- Added Cencori model listing and provider detection so connected users get Cencori models and chat requests target Cencori.
- Added `cencoriApiKey` and `openAIModel` fields to the global config and whitelist.

### Changed

- Cencori login no longer blocks on a failed `/v1/models` fetch. The key is persisted and login succeeds; a one-line note tells the user to pick a model when starting a session.
- API-key screens (Cencori, MyTabulon, Maximo AI) now accept pasted text (Cmd/Ctrl+V) via the bracketed-paste handler instead of silently dropping it.

### Fixed

- Fixed Escape not returning to the login selector from the Cencori key-entry screen.
- Fixed drag-and-drop image attachment failing for basename-only drops (e.g. from `~/Documents` or iCloud Drive). Dropped images now resolve and attach with the same preview and placeholder as copied-paste images.

### Added

- Added `/update` command to update Maximo Syntax to the latest published version via `npm install -g @maximoai/maximo-syntax-cli` (always pulls the `latest` dist-tag). Native and OS-package-manager installs are left to their own update channels.

## [0.1.15] - 2026-07-30

### Added

- Added MyTabulon Coding Plan sign-in through a secure browser OAuth flow, while retaining direct `mtb_live_` API-key setup.
- Added Coding Plan account, workspace, active-plan, model-catalog, and usage-pool integration through MyTabulon's `/v1/me`, `/v1/models`, and `/v1/coding-plan/usage` endpoints.
- Added per-model reasoning-effort discovery and selection. Maximo Syntax now displays and sends only the exact effort levels advertised for the selected model, including `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra` where supported.
- Added native image attachments from clipboard paste and terminal drag-and-drop. Up to 10 images can be attached per prompt, with format, dimensions, original file size, and path shown before sending.
- Added `MAXIMO.md` as the primary project-instructions file while retaining compatibility with `CLAUDE.md` and `AGENTS.md` for users migrating from other coding agents.

### Changed

- MyTabulon Coding Plan sessions now default to Maximo Atlas Preview. Maximo AI subscription and API-usage sessions default to Pandora 3.8 Nano.
- Image attachments preserve the original file bytes without compression or resizing and support payloads up to the 10 MB encoded API limit.
- Replaced the inherited mascot with the Maximo AI outline mark and updated the startup account, plan, and model presentation.
- Maximo Syntax now keeps its runtime files and user configuration under Maximo-owned paths so it can coexist with Claude Code without modifying that installation.
- The MyTabulon authorization completion page now clearly confirms successful authorization and tells the user when it is safe to return to the CLI.

### Fixed

- Fixed pasted and dropped image paths being inserted as plain text instead of being attached to the model request.
- Fixed multi-image attachment races, basename-only VS Code drops, quoted paths, escaped paths, and `file://` drops.
- Fixed image-first turns triggering immediate auto-compaction, losing the pixels, and producing answers based on unrelated transcript history.
- Fixed invalid provider output-token metadata collapsing the effective context window and forcing premature compaction.
- Fixed MyTabulon model selection showing stale Maximo models or missing the signed-in user's active Coding Plan.
- Fixed `/usage` for Coding Plan sessions so it reports the user's current plan and five-hour and weekly usage pools.
- Fixed the model picker reporting that effort was unsupported when the selected MyTabulon model advertises supported effort levels.
- Fixed Up/Down navigation in slash-command and attachment suggestion menus.
- Fixed suggestion focus styling so the accent color and cursor marker move with the active row while inactive rows remain neutral.
- Disabled the inherited Anthropic marketplace auto-install startup hook and its failure notification.
- Removed inherited hardcoded Claude model assumptions and Anthropic account labels from active Maximo Syntax prompts and login UI.
- Fixed OAuth login choices appearing selected at the same time.

## [0.1.13] - 2026-06-05

### Changed

- Refreshed the startup terminal UI with Maximo branding, restored the "Move at Maximo Speed" tagline, and replaced the legacy mascot with a compact octopus mascot.
- Moved "Maximo AI account with subscription" to the first login option.
- Maximo model context, output, and auto-compact thresholds now come from `https://api.maximoai.co/v1/models`, with compact reserves derived from each model's own output-to-context ratio.

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
| 0.1.15 | 2026-07-30 | Added MyTabulon Coding Plan OAuth, usage/model metadata, per-model effort, native image attachments, and product de-collision fixes |
| 0.1.13 | 2026-06-05 | Refreshed startup UI, fixed subscription login billing/input behavior, and repaired session discovery |
| 0.1.11 | 2026-04-10 | Fixed billing display issues in `/usage` command |
| 0.1.10 | 2026-04-10 | Added comprehensive `/usage` command with dual auth support |
| 0.1.0 | 2026-03 | Initial release |

---

For a complete list of changes, see the [GitHub Releases](https://github.com/maximoai/maximo-syntax-cli/releases) page.
