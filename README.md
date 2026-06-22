# Just Code

Milestone 1 ships a working `justcode` CLI built with Ink. It supports OpenAI, Ollama, and LM Studio, loads provider configuration from environment variables, keeps file-backed conversation history, and includes automated tests.

## Setup

1. Install dependencies with `npm install`.
2. Export the provider settings you want to use.

### OpenAI

```bash
export OPENAI_API_KEY="your-api-key"
export JUSTCODE_PROVIDER="openai"
```

### Ollama

```bash
export JUSTCODE_PROVIDER="ollama"
export OLLAMA_BASE_URL="http://127.0.0.1:11434"
```

### LM Studio

```bash
export JUSTCODE_PROVIDER="lmstudio"
export LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"
```

## Commands

```bash
npm run dev -- --provider ollama
npm run dev -- models --provider lmstudio
npm run build
npm test
```

The CLI stores session history under `~/.justcode/sessions` by default.
