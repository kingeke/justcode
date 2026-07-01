# JustCode for VS Code

**A lean, transparent coding assistant in your sidebar — where *you* control
every token.**

Most AI coding tools quietly inflate every request with huge hidden prompts you
can't see or change — some spend tens of thousands of tokens on a single "hey."
JustCode sends roughly **550 tokens per request**, and most of that is a
**system prompt you can read and edit**. No hidden bloat, no wasted spend — your
context, your rules.

This extension brings the same lean engine as the [JustCode
CLI](https://justcodeapp.dev/) into a VS Code chat sidebar.

## Why JustCode

- **~550 tokens per request** — no hidden bloat inflating every call.
- **A system prompt you can read and edit** — no black box.
- **Bring your own provider & key** — OpenAI, Anthropic, OpenRouter, Qwen
  (Alibaba Cloud), Ollama, LM Studio, or any OpenAI-compatible endpoint.
- **See everything it does** — live tool activity and inline approvals before
  any file is written or command is run.
- **MCP servers** and **chat modes** (Build / Ask / Plan + custom), sharing the
  same engine as the CLI.

## Getting started

1. Install the extension and open the **JustCode** view from the activity bar.
2. Connect a provider — either configure one with the
   [JustCode CLI](https://justcodeapp.dev/) or set your provider environment
   variables. The panel shows a notice with instructions until one is connected.
3. Pick a model and start chatting.

## Features

- Streaming chat with live tool activity.
- Inline tool approvals — nothing touches your workspace without your OK.
- In-tool questions, provider/model selection, and one-click new sessions.
- Themed entirely with your VS Code color theme.

## Learn more

Full documentation, the always-current list of tools and commands, and the CLI
live at **[justcodeapp.dev](https://justcodeapp.dev/)**.

JustCode is free and open source (MIT). Issues and contributions welcome at
**[github.com/kingeke/justcode](https://github.com/kingeke/justcode)**.
