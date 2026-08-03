<p align="center">
  <a href="https://maximoai.co/syntax">
    <img src="https://maximoai.co/maximo-syntax-cli-transparent.png" alt="Maximo Syntax CLI logo">
  </a>
</p>
<p align="center">Build, ship, and iterate from your terminal. Maximo Syntax CLI is a powerful AI-powered command-line interface that brings together advanced LLM integration with a lightning-fast developer experience.</p>
<p align="center">
  <a href="https://maximoai.co/syntax"><img alt="Website" src="https://img.shields.io/badge/Website-maximoai.co%2Fsyntax-021027?style=flat-square&logo=google-chrome&logoColor=white" /></a>
  <a href="https://github.com/maximoai/maximo-syntax-cli"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-maximoai%2Fmaximo--syntax--cli-021027?style=flat-square&logo=github&logoColor=white" /></a>
</p>

# Maximo Syntax CLI

**Maximo Syntax CLI** — The official command-line interface natively built for Maximo AI models. Optimized for high-fidelity code generation and agentic task orchestration.

Also compatible with any LLM via OpenAI, Gemini, or Ollama endpoints.

---

## Install

### Option A: npm (recommended)

```bash
npm install -g @maximoai/maximo-syntax-cli
```

### Option B: From source (requires Bun)

Use Bun 1.3.11 or newer for source builds on Windows. Older Bun versions such as 1.3.4 can fail with a large batch of unresolved module errors during `bun run build`.

```bash
# Clone from maximoai
git clone https://github.com/maximoai/maximo-syntax-cli.git
cd maximo-syntax-cli

# Install dependencies
bun install

# Build
bun run build

# Link globally (optional)
npm link
```

`bun run build` creates a production bundle suitable for packaging and keeps
auto-updates available by default. Use `bun run dev` for local development;
that command deliberately creates a development bundle and disables self-update
checks for the source checkout.

---

## Usage

After installation, you can invoke the CLI using any of the following commands:

- `syntax`
- `maximo`
- `maximo-syntax`
- `maximo-syntax-cli`
- `maximo`

All five commands are equivalent and natively supported.

## Scrolling (app-managed by default)

Interactive sessions use **fullscreen alt-screen scroll** by default (`displayMode:
auto`), the same approach as Grok Build: an in-app ScrollBox owns the wheel and
keyboard scroll, sticky follow only while you are pinned to the bottom, and
streaming output cannot yank the viewport while you read earlier turns.

- **Wheel / trackpad** — scroll the conversation; follow pauses automatically.
- **PgUp / PgDn** — page through the transcript from the prompt.
- **End / jump-to-bottom pill** — resume follow of new output.
- **Wheel past the bottom** — also re-enables follow.

Prefer native terminal scrollback instead? Set Display mode to `inline` in
`/config`, or `export MAXIMO_SYNTAX_NO_FLICKER=0`.

## Prompt mouse controls

The prompt supports terminal-native mouse editing in both inline and
fullscreen layouts:

- Click anywhere in the prompt to place the caret, including wrapped and
  multiline input.
- Drag to select text. Double-click selects a word; triple-click selects the
  logical line.
- Selected text is copied on mouse-up by default and stays highlighted. The
  selection can also be replaced by typing, deleted with Backspace/Delete, or
  copied/cut with the usual `Ctrl/Cmd-C` and `Ctrl/Cmd-X` shortcuts.
- Click a visible slash-command or file suggestion to accept that row
  immediately. Keyboard navigation remains available.

```bash
# Keep the prompt from enabling mouse reporting.
export MAXIMO_SYNTAX_DISABLE_MOUSE=1

# In fullscreen, keep wheel scrolling but disable prompt click/drag actions.
export MAXIMO_SYNTAX_DISABLE_MOUSE_CLICKS=1

# Keep the terminal's native caret visible for screen readers and magnifiers.
export MAXIMO_SYNTAX_ACCESSIBILITY=1
```

The `copyOnSelect` setting can be changed from the configuration screen. OSC
52 and the local clipboard utility are used where available, with terminal
mouse tracking restored automatically after fullscreen overlays, resize, or
terminal suspend/resume.

## Interactive TUI controls

The command palette searches live actions, slash commands, and skills. Open it
with `Ctrl+P` in most terminals. In VS Code's integrated terminal, where
`Ctrl+P` belongs to the editor, use the chord `Ctrl+X`, then `P`. The active
shortcut is shown contextually in the prompt footer and can be changed under
`/config` with the terminal shortcut profile.

Prompt editing includes attachment-aware undo and redo. Use `Ctrl+_` to undo
and `Ctrl+Y` to redo. Images and large pasted-text references behave as atomic
chips: navigation snaps to chip boundaries, deleting a selected chip removes
the matching content, and undo/redo restores the text, caret, and attachment
state together.

While prompts are queued, open the interactive queue with `Ctrl+Q` (`Ctrl+X`,
then `Q` in VS Code). The pane supports:

- `Enter` to move an editable queued prompt back into the editor.
- `N` to prioritize it for immediate sending.
- `D` or Delete to remove it.
- `Ctrl+Up` / `Ctrl+Down` to reorder it.
- Typing to filter the queue.

Open the detailed transcript with `Ctrl+O`. Scrollback supports mouse-wheel
and keyboard scrolling, `/` incremental search, `N`/`Shift+N` match navigation,
text selection and copy, and automatic follow while pinned to the bottom.
Manual scrolling pauses follow; returning to the bottom resumes it. Press
`Shift+Up` or click a message to focus it, then use Up/Down or `J`/`K` to move
between turns, Enter to fold or expand supported rows, `C` to copy, `R` for
raw view, and Escape to return. Press `[` to dump the complete expanded
transcript into native terminal scrollback, or `V` to open it in `$VISUAL` or
`$EDITOR`.

`/config` also exposes display mode (`auto` = fullscreen scroll by default;
`inline` = native terminal scrollback; `fullscreen` / `compact` force the
alt-screen layout), UI density, prompt border style, reduced motion, contextual
shortcut hints, and response-completion notifications. Notifications can be
limited to times when the terminal is unfocused.

## Skills and cross-CLI compatibility

Maximo Syntax reads the shared `SKILL.md` format and normalizes skills from
Maximo, Agent Skills, Codex, Claude Code, Gemini CLI/Antigravity, Grok CLI, and
OpenCode layouts. Existing native Maximo roots keep their normal precedence;
provider-qualified aliases (for example `claude:review`) keep same-named skills
addressable.

Supported project roots are:

- `.maximo/skills/`
- `.agents/skills/`
- `.claude/skills/`
- `.gemini/skills/`
- `.grok/skills/`
- `.opencode/skills/`

The same provider roots are checked in their documented user locations, such
as `~/.agents/skills/`, Codex's `~/.codex/skills/` (or `$CODEX_HOME/skills/`),
`~/.claude/skills/`, `~/.gemini/skills/`, `~/.grok/skills/`,
`~/.config/opencode/skills/`, and the Antigravity Gemini skill roots.

In the TUI:

- Type `/skill-name` or `/skill-name arguments` to invoke a skill directly.
- Type `$skill-name` inside a normal prompt to explicitly guide Maximo to load
  that known skill before handling the rest of the prompt. Unknown `$words` and
  shell variables such as `$HOME` remain ordinary text.
- Run `/skills` to open the picker. Select a skill to insert its `/command`, or
  select the creator.
- Run `/skills create` or `/skill-creator` to create a reusable skill.
  `/create-skill` and the legacy `/skillify` names remain aliases.
- Run `/skills reload` after external changes. `/skills info <name>`,
  `/skills use <name>`, `/skills link <path> [--scope user|workspace]`, and the
  session-only `enable`/`disable` helpers are also available.

Skills use a directory containing `SKILL.md`, for example:

```text
.agents/skills/release-notes/SKILL.md
```

The recommended portable frontmatter includes `name` and `description`; Maximo
also supports compatible fields such as `allowed-tools`, `when_to_use`,
`argument-hint`, `arguments`, `context`, `user-invocable`, and
`disable-model-invocation`.

---

## Login

Maximo Syntax CLI supports several ways to sign in. Run the login flow and pick the option that matches your setup:

```bash
maximo login
```

| Option | What it is | Notes |
|--------|------------|-------|
| **Maximo AI account** | First-party Maximo AI subscription/pro API key | Default provider; routes through `https://api.maximoai.co/v1`. |
| **MyTabulon Coding Plan** | MyTabulon platform API key (`mtb_live_…`) | Sign in via browser OAuth or paste a `mtb_live_` key. |
| **Cencori** | Cencori OpenAI-compatible API key (`csk_…`) | Cencori is OpenAI-compatible, so chat and models go through `https://api.cencori.com/v1`. Paste your `csk_` key at the prompt — the key is saved to your global config and used for all API calls. |
| **3rd-party platform** | OpenAI, Gemini, Bedrock, Ollama, and more | Set the relevant environment variables and restart. See [Alternative Providers](#alternative-providers). |

To switch providers (e.g. to Cencori) at any time, run `maximo login` again and choose the provider you want.

---

## Keeping Maximo Syntax up to date

Maximo Syntax installs via npm, so updating is just reinstalling the latest published version:

```bash
npm install -g @maximoai/maximo-syntax-cli
```

You can also update right from inside the CLI:

```bash
/update
```

`/update` runs `npm install -g @maximoai/maximo-syntax-cli` (always pulls the `latest` dist-tag) and tells you to restart the CLI once it finishes. Native and OS-package-manager installs are left to their own update channels.

---

## Permission modes (auto & always-approve)

Maximo Syntax can run with fewer (or no) permission prompts. There are **two different modes**:

| Mode | How to enable | Classifier? | Notes |
|------|---------------|-------------|--------|
| **Default (ask)** | *(default)* | No | Prompts for risky tools; read-only work is free |
| **Accept edits** | Shift+Tab | No | File edits in the project without prompts |
| **Plan** | `/plan` or Shift+Tab | No | Read-only planning until you approve |
| **Auto (classifier)** | `/auto` → pick **Auto · classifier**, or `--permission-mode auto` | **Yes** | Safe tools run; risky ones are classified first. Footer: `◎ auto · classifier on` |
| **Always-approve (YOLO)** | `/auto` → pick **Always-approve**, or `/yolo`, `--always-approve`, `--yolo` | **No** | Almost no prompts — **sandbox/VM recommended**. Footer: `⚠ always-approve · no classifier on` |

**In the TUI, run `/auto`** and choose which version you want (classifier, always-approve, or off). Aliases `/yolo` and `/always-approve` open the same picker. The prompt footer and Shift+Tab toast show the active mode; `/status` lists it too.

### Classifier auto mode

- Available when you are logged in via **Maximo AI** or **MyTabulon**.
- Uses your **currently selected model** as the classifier (same login credentials).
- **Warning:** each classified tool call is an extra API request and **consumes additional usage-pool quota** beyond the main agent.
- Deny rules and hooks still apply. Prefer a sandbox for long unattended runs.

```bash
maximo --permission-mode auto
# or in the TUI:
/auto
```

### Always-approve (no classifier)

```bash
maximo --always-approve
maximo --yolo
# or in the TUI:
/always-approve
/yolo
```

Deny rules and PreToolUse hooks still apply. There is **no** safety classifier — only use this when you trust the environment.

---

## Images: paste and drag-and-drop

You can attach images to a prompt by **copy-paste** or by **dragging and dropping** a file into the terminal — both work the same way:

- Pasted images are read from the clipboard and attached inline.
- Dragged images are resolved from the dropped file path (including basename-only drops from common folders like `~/Documents`, `~/Desktop`, `~/Pictures`, and iCloud Drive).

In both cases the image is previewed with a `[Image #N]` reference before you send, and the original bytes are preserved (no silent resize or recompress). Up to 10 images can be attached per prompt.

---

## Quick Start

### 1. Set up Maximo AI (Recommended)

Maximo Syntax CLI uses Maximo AI as the default provider. Get your API key from [Maximo AI](https://maximoai.co/platform) and set the following environment variables:

```bash
export MAXIMO_SYNTAX_USE_OPENAI=1
export OPENAI_API_KEY=your-maximo-api-key
export OPENAI_BASE_URL=https://api.maximoai.co/v1
export OPENAI_MODEL=maximo-pandora-3.7-nano
```

Or create a `.env` file in your project directory:

```
MAXIMO_SYNTAX_USE_OPENAI=1
OPENAI_API_KEY=your-maximo-api-key
OPENAI_BASE_URL=https://api.maximoai.co/v1
OPENAI_MODEL=maximo-pandora-3.7-nano
```

### 2. Run Maximo Syntax CLI

```bash
maximo
```

---

## Alternative Providers

### OpenAI / Any OpenAI-compatible provider (GPT-4o, DeepSeek, Ollama, Groq)

```bash
export MAXIMO_SYNTAX_USE_OPENAI=1
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o
```

### Google Gemini (free key at https://aistudio.google.com/apikey)

```bash
export MAXIMO_SYNTAX_USE_GEMINI=1
export GEMINI_API_KEY=your-key
```

### Amazon Bedrock

See documentation: https://code.maximo.com/docs/en/amazon-bedrock

### Microsoft Foundry

See documentation: https://code.maximo.com/docs/en/microsoft-foundry

### Vertex AI

See documentation: https://code.maximo.com/docs/en/google-vertex-ai


---

## Documentation

- [Maximo AI Documentation](https://maximoai.co/syntax)
- [GitHub Repository](https://github.com/maximoai/maximo-syntax-cli)
- [Changelog](./CHANGELOG.md)

---

## Security

If you believe you found a security issue, see [SECURITY.md](./SECURITY.md).

## Contributing

Contributions are welcome.

For larger changes, open an issue first so the scope is clear before implementation. Helpful validation commands include:

```bash
bun run build
bun run smoke
# focused bun test ... runs for touched areas
```

## Disclaimer

Maximo Syntax CLI is an independent community project and is not affiliated with, endorsed by, or sponsored by Anthropic.

"Claude" and "Claude Code" are trademarks of Anthropic.

## License

MIT
