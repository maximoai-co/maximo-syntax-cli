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

- `maximo`
- `maximo-syntax`
- `maximo-syntax-cli`

All three commands are equivalent and natively supported.

---

## Quick Start

### 1. Set up Maximo AI (Recommended)

Maximo Syntax CLI uses Maximo AI as the default provider. Get your API key from [Maximo AI](https://maximoai.co/platform) and set the following environment variables:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=your-maximo-api-key
export OPENAI_BASE_URL=https://api.maximoai.co/v1
export OPENAI_MODEL=maximo-pandora-3.6-nano
```

Or create a `.env` file in your project directory:

```
CLAUDE_CODE_USE_OPENAI=1
OPENAI_API_KEY=your-maximo-api-key
OPENAI_BASE_URL=https://api.maximoai.co/v1
OPENAI_MODEL=maximo-pandora-3.6-nano
```

### 2. Run Maximo Syntax CLI

```bash
maximo
```

---

## Alternative Providers

### OpenAI / Any OpenAI-compatible provider (GPT-4o, DeepSeek, Ollama, Groq)

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o
```

### Google Gemini (free key at https://aistudio.google.com/apikey)

```bash
export CLAUDE_CODE_USE_GEMINI=1
export GEMINI_API_KEY=your-key
```

### Amazon Bedrock

See documentation: https://code.claude.com/docs/en/amazon-bedrock

### Microsoft Foundry

See documentation: https://code.claude.com/docs/en/microsoft-foundry

### Vertex AI

See documentation: https://code.claude.com/docs/en/google-vertex-ai

---

## Documentation

- [Maximo AI Documentation](https://maximoai.co/syntax)
- [GitHub Repository](https://github.com/maximoai/maximo-syntax-cli)
