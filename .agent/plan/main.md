# JustCode v1 Plan

## High-Level Architecture

JustCode should be a monorepo with a strict boundary between UI, application logic, domain, and infrastructure.

The key architectural choice for v1: the CLI is the source of truth and the brain. The VS Code extension is a thin client that delegates work to the CLI through a transport layer. That keeps the model, provider, and tool logic in one place and avoids duplicating behavior across surfaces.

### Dependency Direction

- `presentation` depends on `application`
- `application` depends on `domain` and `ports`
- `infrastructure` implements `ports`
- `domain` depends on nothing outside itself

## Folder Structure

```text
just-code/
  apps/
    cli/
      src/
        commands/
        ui/
        bootstrap/
        transport/
    vscode-extension/
      src/
        extension/
        client/
        views/
        commands/
        transport/
  packages/
    core/
      src/
        domain/
        application/
        ports/
        policies/
    providers/
      src/
        openai/
        anthropic/
        gemini/
        openrouter/
        shared/
    tools/
      src/
        file/
        search/
        shell/
        workspace/
        shared/
    runtime/
      src/
        config/
        logging/
        persistence/
        container/
        env/
    protocol/
      src/
        messages/
        events/
        schemas/
        codec/
    shared/
      src/
        errors/
        ids/
        result/
        utils/
  docs/
  scripts/
```

## Folder Responsibilities

### `apps/cli`

- Commander.js command entrypoints
- Ink UI rendering
- Process startup, argument parsing, and session bootstrapping
- Local transport server/client for the VS Code extension

### `apps/vscode-extension`

- Extension activation and command registration
- Minimal UI for chat, session status, and task submission
- Delegation to the CLI transport
- No provider or tool logic

### `packages/core`

- Domain entities and value objects
- Application use cases
- Interfaces the rest of the system depends on
- Agent loop orchestration
- History/session abstractions

### `packages/providers`

- Provider-specific API adapters
- Message format conversion
- Streaming and tool-call normalization
- Model listing and capability discovery

### `packages/tools`

- Concrete tools like file read, file edit, search, shell command
- Tool validation and execution wrappers
- Workspace safety rules
- Cross-platform command execution concerns

### `packages/runtime`

- Wiring and composition root
- Config loading
- Environment detection
- Logging
- Persistence setup
- Dependency injection container if used

### `packages/protocol`

- Wire format between CLI and extension
- Message schemas
- Event types
- Serialization/deserialization
- Versioning for compatibility

### `packages/shared`

- Small cross-cutting primitives only
- `Result` type, IDs, errors, helpers
- Keep this minimal to avoid becoming a junk drawer

## Core Interfaces And Abstractions

### `LLMProvider`

- Responsible for sending chat requests to a model and receiving streamed or non-streamed results
- Normalizes provider differences
- Supports tool calling and token streaming
- Hidden behind a common internal contract

### `ModelCatalog`

- Lists available models for a provider
- Surfaces capabilities like tool calling, streaming, context window, and pricing metadata if needed

### `ChatSessionRepository`

- Loads and saves conversation state
- Supports resume, branching later, and durable history

### `ConversationStore`

- Stores messages and checkpoints
- Can be file-based for v1, with room for SQLite later

### `AgentRunner`

- Owns the main loop
- Takes user intent, model output, tool results, and termination conditions
- Produces events and final assistant responses

### `Tool`

- Declarative tool metadata plus executable behavior
- Each tool has a name, description, schema, and handler
- Input validation should use Zod

### `ToolRegistry`

- Registers available tools
- Resolves tools by name
- Can expose tool metadata to the model

### `ToolExecutor`

- Executes a selected tool with validated input
- Enforces allow/deny rules, workspace boundaries, and approval flow

### `ToolContext`

- Shared execution context for tools
- Includes workspace root, config, logger, cancellation token, history snapshot, and permissions

### `WorkspaceService`

- Safe file and path operations rooted in the project workspace
- Prevents accidental access outside the intended boundary

### Narrow Workspace Ports

- `FileReader`
- `FileEditor`
- `CodeSearch`
- `CommandExecutor`

These are better than one giant filesystem interface because they keep responsibilities clean.

### `SessionManager`

- Creates, resumes, and switches sessions
- Coordinates history and active workspace state

### `Transport`

- Abstracts communication between CLI and VS Code extension
- Keeps protocol details out of UI and application logic

### `EventStream`

- Emits tokens, tool events, status updates, errors, and completion signals
- Useful for both Ink and extension UI

### `ApprovalPolicy`

- Decides when destructive or risky actions require confirmation
- Important for shell commands and file edits

## Domain Primitives

- `Message`
  - Role, content, metadata, timestamps, and tool references
- `Conversation`
  - Ordered collection of messages plus session metadata
- `ToolCall`
  - Tool name, schema-validated input, correlation ID, and status
- `ToolResult`
  - Output, structured payload, errors, and side effects summary
- `ModelRequest` and `ModelResponse`
  - Internal normalized provider contract
- `AgentStep`
  - One cycle of model reasoning, tool invocation, or final response
- `Workspace`
  - Root path, file boundaries, and project metadata

## Architectural Rules

- The CLI owns persistence, provider access, and tool execution.
- The extension never talks to model providers directly.
- Every tool input must be schema-validated.
- The agent loop must be stream-first so both CLI and extension can render progress.
- All file and shell operations must be workspace-scoped by default.
- Provider-specific quirks stay in adapters, not in the agent loop.
- The core should be runnable in tests without the CLI or VS Code present.
