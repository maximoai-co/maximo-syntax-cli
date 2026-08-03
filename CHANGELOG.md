# Changelog

All notable changes to Maximo Syntax CLI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.22] - 2026-08-03

### Added

- **Classifier decisions on stream-json**: auto-mode and bash classifier outcomes (allowed/denied) are now emitted as `system`/`classifier_decision` messages on `stream-json` output, so desktop and SDK hosts can show "allowed/denied by classifier" next to each tool use — matching the TUI's in-memory labels.

### Changed

- **App-managed fullscreen scroll is now the default** (`displayMode: auto`): interactive sessions render through an alt-screen ScrollBox like Grok Build's pager, so wheel/PgUp/PgDn scroll an in-app viewport with sticky follow instead of fighting native terminal scrollback. Opt out with `/config` → Display mode → `inline`, or `MAXIMO_SYNTAX_NO_FLICKER=0`.

### Fixed

- **Smooth scroll while the agent is working (once-and-for-all)**: the "cursor keeps getting pushed down" jank is fixed. Sticky follow is flag-only — manual scroll breaks follow and content growth will not re-pin until you return to the bottom (wheel past the end, End, or the jump-to-bottom pill).
- **Main-screen fallback**: if you force inline mode, wheel still suspends prompt mouse tracking and **suppresses caret park/calibration** while you scroll so streaming re-renders cannot yank the viewport back to the prompt.

## [0.1.23] - 2026-08-03

### Fixed

- **Scroll no longer jumps mid-gesture**: virtualized rows remeasure estimate→real heights; that used to shift content under the viewport. Height changes above the fold now **anchor** via `nudgeScrollTop` (adjusts scrollTop without breaking sticky or treating it as a user gesture). Wheel drain uses small per-frame steps (not “¾ of remaining”), wheel acceleration caps are lower so trackpad/mouse motion stays continuous, and past-clamp catch-up uses the same smooth curve instead of racing ahead.

## [0.1.21] - 2026-08-03

### Fixed

- **npm deprecation notice points at Maximo's own docs**: the startup notification shown to npm-installed users ("Maximo Syntax has switched from npm to native installer") now links to `https://maximoai.co/syntax` instead of Anthropic's Claude Code getting-started docs.

## [0.1.20] - 2026-08-02

### Added

- **Mouse-first prompt editing and visible caret**: the normal TUI prompt now supports clicking to place the insertion point, click-drag text selection, double-click word selection, triple-click line selection, copy-on-select, and clickable completion rows. Focused text inputs expose the terminal's native blinking bar caret at the exact editing position, including wrapped and multiline input, while preserving keyboard, Vim, IME, accessibility, and terminal-selection fallbacks.
- **Unified interaction architecture and command palette**: added a searchable action registry spanning registered keyboard actions, slash commands, and skills. The command palette uses terminal-aware defaults (`Ctrl+P` normally and `Ctrl+X P` in VS Code), while one interaction-priority layer now orders global keys, prompt editing, transcript navigation, text selection, overlays, permission dialogs, mouse input, and single-layer Escape dismissal.
- **Full prompt editor history and atomic content**: added attachment-aware undo and redo, atomic image and pasted-text chips, boundary-safe cursor movement, and collision-free attachment-ID rebasing when queued prompts are restored into a non-empty editor. Undo/redo restores text, caret, pasted content, and attachments as one state.
- **Interactive prompt queue**: added a searchable queue pane with edit, remove, send-now priority, and reordering controls. Queue edits preserve mode and attachments, system-generated entries remain read-only, and contextual hints expose the available operations.
- **Focusable fullscreen scrollback**: enabled click-to-focus transcript messages in the public build, keyboard turn navigation, per-message folding, copy/edit actions, incremental `/` search with `n`/`N`, raw-message view, full transcript view, terminal-scrollback dump, and sticky follow mode that pauses on manual scrolling and resumes at the bottom.
- **Terminal-native UX profiles and notifications**: added automatic and user-selectable shortcut profiles for portable terminals, modern Kitty-protocol terminals, VS Code, and Apple Terminal. Response completion can now issue native terminal notifications with foreground-focus suppression.
- **Display and theme controls**: added auto, fullscreen, inline, and compact display modes; comfortable/compact density; round, single, double, and classic prompt borders; reduced motion; and a switch for contextual shortcut hints. The idle footer now advertises the active terminal-specific command-palette shortcut.
- **Portable cross-provider skills**: Maximo Syntax now discovers shared `SKILL.md` skills from native Maximo, `.agents`, Codex (`$CODEX_HOME/skills` or `~/.codex/skills`), Claude Code, Gemini CLI/Antigravity, Grok CLI, and OpenCode project and user roots. Native Maximo precedence is preserved, while provider-qualified aliases such as `claude:review` keep same-named skills addressable.
- **Skill invocation and creation UX**: Added the `/skills` TUI picker and management commands for `reload`, `create`, `info`, `use`, `link`, `enable`, `disable`, and `disabled`; inline `$skill-name` mentions now have autocomplete and explicitly load known skills without changing ordinary shell variables. Added the guided `/skill-creator` command with `/create-skill` and `/skillify` aliases.
- **Skill safety and lifecycle support**: Added live discovery reloads, portable frontmatter compatibility, `--add-dir` provider roots, session-only disabling, and permission/sandbox protections for every supported skill root. Portable skills default to `.agents/skills`, while `.maximo/skills` remains available for Maximo-only workflows.
- **Eager auto-update check at startup**: the CLI now checks for updates right after first render on both interactive and headless (`-p`) sessions, instead of only after the REPL footer mounts (which never happens headless). The check is non-blocking, skipped for `--bare` and when auto-updates are disabled, and throttled to once per hour via a persisted cooldown so it composes with the existing 30-minute REPL interval without double-installing.
- **Reusable update engine** (`checkAndInstallUpdate`): the check+install guard chain (disable checks, server max-version kill switch, min-version skip, lock file, installation-type dispatch) was extracted from the React `AutoUpdater` into a non-React function shared by the startup check and the REPL updater, so all paths stay in sync.
- **OS-level daily background updater**: a hidden `--auto-update` entrypoint runs the update engine headlessly and fires a native OS notification when an update installs. The CLI reconciles an OS scheduled task (launchd on macOS, cron on Linux/WSL, Task Scheduler on Windows) at startup so users who rarely open a terminal still get automatic daily updates; the task is unregistered when auto-updates are turned off.
- **`/config` auto-update toggle**: a new "Auto-update" on/off setting in `/config` enables or disables auto-updates (persisting `autoUpdates` in config and reconciling the OS scheduler), replacing the previous env-var-only control.
- **`/status` auto-update info**: `/status` now shows the real package version, and an "Auto-update" line reporting enabled/disabled state, release channel, whether the daily background task is active, and how long ago the last check ran.
- **Staged rollout + security force-updates** (server-driven via `tengu_update_rollout_config`): a rollout percentage gates auto-updates to a deterministic, sticky cohort per release (hash of user ID + target version), so a new release can be rolled out gradually. A security cutoff date + minimum version force-installs critical patches after the deadline, bypassing the user's auto-update opt-out and the rollout gate (but still respecting the incident kill switch).
- **Proactive heap monitor for long-running sessions**: a memory guard polls heap usage and, when it approaches the default V8 ceiling (which fatally OOMs the process — the classic "CLI open for hours then died" failure), logs the pressure, runs GC, and writes a crash marker so the next start can surface it. `/status` now reports a "Memory" line with live heap usage and a high/critical/extreme hint (e.g. "consider /compact").
- **Child-process heap ceiling**: the launcher now sets `--max-old-space-size=6144` for spawned sub-agents (never overriding an explicit user value), so sub-processes stop hitting the default ~2GB ceiling on long sessions.

### Fixed

- **Release builds no longer inherit development auto-update state**: `bun run dev` now explicitly creates a development bundle, while normal `bun run build` and package-preparation builds explicitly create production bundles. Published installations therefore keep auto-updates enabled by default unless the user, environment, or administrator disables them.
- **Click-to-caret now works in VS Code and scrolled terminals**: prompt hit-testing now calibrates Maximo's frame-relative rows against the terminal's absolute viewport coordinates using cursor-position reports, then recalibrates when prompt/footer geometry changes. Mouse reporting is reasserted after renders, focus changes, resize, resume, and terminal recovery; both SGR and legacy X10 click/drag/release reports are parsed, and cursor/mouse modes are restored safely on suspend and exit.
- **Auto-update version comparison now uses the real package version**: `MACRO.VERSION` is the internal compatibility version (`99.0.0` in open builds, kept high to pass first-party minimum-version guards) — comparing it against npm's `latest` always looked "up to date", so auto-update never triggered for open builds. Update checks, `/update`, and the `update` CLI subcommand now compare against `MACRO.DISPLAY_VERSION` (the actual published version, e.g. `0.1.20`) via a new `getCurrentRealVersion()` helper.
- **Native installer version comparison uses the real package version**: the native installer's "already running this exact version" fast-path and its max-version check compared against the internal `MACRO.VERSION` (`99.0.0`), so the fast-path never matched and the native updater would re-download/reinstall on every check even when already current. Both now use `getCurrentRealVersion()`.
- **Shutdown crash now diagnosable**: if the graceful-shutdown failsafe force-exits (hung cleanup on a dead TTY/network), it logs a `shutdown_failsafe_fired` diagnostic with uptime, heap, and reason before killing, so a hard exit is no longer a mystery.
- **Auto-update async paths can no longer crash a long session**: the fire-and-forget startup update check and scheduler reconciliation now swallow rejections, and the update engine itself catches its own errors (network blips, failed lazy imports, spawn errors) and degrades to a logged failure instead of rejecting.
- **Saved `/model` choice no longer resets on restart**: `OPENAI_MODEL` is set internally by the CLI's provider setup (Maximo AI OAuth login, `managedEnv` key injection) to a hardcoded default like `maximo-pandora-3.8-nano`. That internal value was being read *before* the user's saved `settings.model`, silently clobbering an explicit `/model` selection every session. Model resolution now prefers `settings.model` over the internal `OPENAI_MODEL` env var (genuine user `ANTHROPIC_MODEL`/`GEMINI_MODEL` overrides and `--model` still take precedence).
- **`/auto` permission mode now survives restart**: `/auto` (classifier), `/auto always-approve`, and `/auto off` previously set the mode only for the current session (`destination: 'session'`) without persisting, so the mode reset to default prompts on every launch. The mode is now written to `settings.permissions.defaultMode` (restored by `initialPermissionModeFromCLI` at startup). The always-approve confirm dialog's "for this session" option and the auto opt-in dialog's plain "enable" option remain session-only; "remember my choice" / "make it my default" persist.
- **Image reads no longer stall across providers**: images returned by `Read` are now forwarded as vision inputs for OpenAI-compatible Chat Completions providers (Maximo AI, MyTabulon, Cencori) and Codex Responses, with `API_TIMEOUT_MS` (10-minute default) covering both request headers and streaming bodies. Packaged builds also use image-header dimensions when optional image processors are unavailable, avoiding unnecessary compression retries.

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
