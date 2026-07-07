# Sub Agents for JustCode — Implementation Plan

## Approach

Register sub agents as a single new tool (`task`), following the Claude Code pattern. When
the main model calls `task`, the tool runs its **own lightweight agentic loop** against the
same provider/model with a **restricted tool registry**, and returns only the final summary
as the tool result. The parent's context stays clean.

## 1. Core domain (`packages/core`)

- **`domain/tool-name.ts`** — add `ToolName.Task = 'task'`.
- **`domain/sub-agent.ts`** (new) — `SubAgentType` enum + per-type config:
  - `Explorer` — read-only research (tools: `read_file`, `grep`, `glob`, `webfetch`,
    `websearch`). Auto-approved since nothing mutates.
  - `General` — full toolset minus interactive/recursive tools (`task`, `question`,
    `present_plan`, `todowrite`). _(v1 could ship Explorer only — decision below.)_
  - Each type carries: allowed `ToolName[]`, system prompt, and `requiresApproval` flag.
- **`application/sub-agent-runner.ts`** (new) — a minimal agentic loop (~100 lines),
  deliberately **not** reusing `ChatSessionService` (which is entangled with persistence,
  approvals, compaction, titles):
  - Inputs: `ProviderClient`, model, `ToolRegistry` (filtered), prompt, system prompt,
    `AbortSignal`, max-iterations cap (e.g. 25) and a token/turn budget.
  - Loop: send messages → execute tool calls → append results → repeat until the model
    replies with no tool calls → return final text.
  - Emits an optional `onToolActivity` callback so the host UI can show nested progress.
  - Also emits an `onTranscriptEvent` stream (messages, tool calls, tool results) so the
    host can render and persist the sub agent's full conversation (see §4).

## 2. Runtime tool (`packages/runtime/src/tools/task-tool.ts`)

- `TaskTool implements Tool`:
  - Args schema: `{ agent_type: enum, prompt: string, description: string }`
    (`description` = short label for UI).
  - Constructor receives a factory:
    `() => { provider: ProviderClient; model: string; registry: ToolRegistry }` — wired in
    `create-services.ts` so it always sees the live model selection and MCP-augmented
    registry.
  - `execute`: builds a filtered `ToolRegistry` from the agent type's allow-list, runs the
    sub-agent runner, returns `{ content: summary }`. Errors/aborts return
    `isError: true`.
  - `describe`: title `Task (explorer): <description>`, preview = prompt.
  - `requiresApproval`: `false` for `Explorer` (read-only), `true` otherwise. Sub agents
    never get `askUser` — they can't talk to the user.
  - Guard: strip `ToolName.Task` from the sub registry (no recursive spawning, v1).

## 3. Wiring (`create-services.ts`)

- Instantiate `TaskTool` with the factory closure over the existing provider registry +
  live tool registry; add to the built-in tool list (respecting lazy-load: advertise it up
  front alongside the gateway, since delegation is most useful early).

## 4. Persistence — sub agent transcripts in the conversation JSON

Sub agent conversations must be reviewable after the fact, so each run is saved as its own
entry in the conversation file:

- **`domain/conversation.ts`** — add an optional `subAgentRuns: SubAgentRun[]` field.
  Each `SubAgentRun` carries:
  - `id` (the parent tool call id, so UIs can link the `task` call to its run),
  - `agentType` (`SubAgentType` enum), `description`, `prompt`,
  - `status` (enum: `Running` | `Completed` | `Failed` | `Aborted`),
  - `messages: ChatMessage[]` — the sub agent's full transcript (reusing the existing
    message shape so existing renderers work),
  - `startedAt` / `endedAt`, and the final `summary`.
- `SubAgentRun`s are **never sent to the model** (like `compactedMessages`); they exist
  purely for review/persistence.
- The runner's `onTranscriptEvent` appends to the run's `messages`; the session service
  saves the conversation on run start, periodically during the run, and on completion so a
  crash still leaves a reviewable partial transcript.
- `file-conversation-repository` needs no schema migration beyond tolerating the new
  optional field (add a round-trip test).

## 5. Live progress events for hosts

`ChatSessionService`/`TaskTool` surface a new `SubAgentActivityEvent` alongside the
existing `ToolActivityEvent`:

- `{ runId, agentType, description, phase: 'start' | 'progress' | 'end', latestActivity?, status? }`
- `latestActivity` is a one-line human summary of what the sub agent just did (e.g.
  `grep "ToolRegistry"` or `reading tool.ts`), derived from each tool's `describe()` title.
- Hosts subscribe to this to drive both UIs below.

## 6. VS Code webview UI (`apps/vscode`)

View-only review of sub agents, styled after the existing floating scroll up/down buttons
in the right panel:

- **Indicator button**: when there are running (or recent) sub agent runs, show a floating
  icon in the same right-edge button stack as the scroll buttons, with a badge for the
  number of active runs. Hidden when there are no runs.
- **Run list**: clicking the icon opens a small panel listing runs by `description`, with
  status (spinner while running, check/cross when done) and elapsed time.
- **Transcript view**: clicking a run opens a read-only transcript of that sub agent's
  conversation (rendered with the existing message/tool-activity components), live-updating
  while the run is in progress via `SubAgentActivityEvent` + transcript events. No input
  box — strictly view-only.
- Historical runs load from `conversation.subAgentRuns` when reopening a session.

## 7. CLI UI (`apps/cli`)

Claude Code-style in-terminal review:

- **Main transcript progress**: while sub agents run, the parent's tool-activity row for
  each `task` call shows live progress (`⏺ Task (explorer): find auth bug — 12 tool uses ·
grep "session"`), updated from `SubAgentActivityEvent`.
- **Arrow-key switching**: when one or more sub agents are active, arrow keys cycle the
  focused sub agent; the focused agent's recent transcript lines render in a bordered,
  view-only pane above the input, with a header like
  `[2/3] explorer: find auth bug (esc to return)`.
- Esc returns focus to the main conversation; the pane disappears when all runs finish.
- Key handling must not conflict with existing history navigation — only intercept arrows
  while the sub agent pane is focused/toggled.

## 8. Tests (per AGENTS.md)

- `sub-agent-runner.test.ts` — loop terminates on plain reply, executes tool calls,
  respects iteration cap and abort signal.
- `task-tool.test.ts` — arg parsing/describe, tool filtering per agent type, no recursive
  `task`, error surfaces as `isError`.
- Conversation domain/persistence tests — `subAgentRuns` round-trips through the file
  repository; status transitions (`Running` → `Completed`/`Failed`/`Aborted`).
- CLI tests — arrow-key focus cycling and progress-line rendering; webview tests for the
  indicator/list/transcript components where the existing test setup allows.
- Extend `tool-registry`/`create-services` coverage if wiring logic warrants it.
- `npm run format` + `npm run typecheck` after changes.

## Key decisions / trade-offs

- **Tool, not a slash command**: the _model_ decides when to delegate, matching the
  existing tool-call architecture.
- **New minimal runner vs reusing `ChatSessionService`**: reuse would drag in
  persistence/approval/compaction concerns and an in-memory repo hack; a small dedicated
  loop is simpler and testable.
- **Same model for sub agents** in v1; per-agent-type model override is an easy later
  extension.
- **Open question**: ship v1 with `Explorer` only (zero-risk, read-only, no approvals) or
  include `General` (can edit files/run bash inside a sub agent, which bypasses per-call
  approval)? Recommendation: **Explorer-only for v1**.
