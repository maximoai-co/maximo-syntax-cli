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

---

## Usage

After installation, you can invoke the CLI using any of the following commands:

- `syntax`
- `maximo`
- `maximo-syntax`
- `maximo-syntax-cli`
- `maximo`

All five commands are equivalent and natively supported.

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
