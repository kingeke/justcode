import { randomUUID } from 'node:crypto';

import type { Conversation } from '@core/domain/conversation';
import { APP_NAME } from '@core/branding';
import type { MessageRole } from '@core/domain/message';
import type { ModelInfo, ProviderClient } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import type {
  ToolApprovalRequest,
  ToolActivityEvent,
} from '@core/application/chat-session-service';
import type {
  ToolInvocationView,
  UserQuestionRequest,
} from '@core/ports/tool';
import { cacheDirectory } from '@core/application/cache-dir';
import {
  deleteDebugLog,
  setDebugLogDirectory,
} from '@core/application/debug-log';
import { DEFAULT_MAX_READ_LINES } from '@core/application/read-window';
import { PROVIDER_BY_ID } from '@core/ports/provider-catalog';
import {
  readGlobalConfig,
  writeGlobalConfig,
} from '@runtime/persistence/global-config';
import {
  createRuntimeServices,
  type RuntimeServices,
} from '@runtime/bootstrap/create-services';

import {
  HostMessageType,
  ToolPhase,
  WebviewMessageType,
  WebviewRole,
  type HostToWebview,
  type WebviewMessage,
  type WebviewToHost,
  type WebviewModel,
  type WebviewToolView,
} from '@ext/shared/protocol';

/** Longest tool-result snippet we forward to the webview as a preview. */
const RESULT_PREVIEW_LIMIT = 2000;

/**
 * Owns a single chat session and translates between the webview's message
 * protocol and `ChatSessionService`. It is deliberately ignorant of VSCode: the
 * host hands it a `post` function and forwards inbound webview messages, which
 * keeps the agent wiring unit-testable without a real webview.
 */
export class ChatBridge {
  private services: RuntimeServices | undefined;
  private conversation: Conversation | undefined;
  private activeModel: string | undefined;
  private models: ModelInfo[] = [];
  private abortController: AbortController | undefined;
  private readonly pendingApprovals = new Map<
    string,
    (approved: boolean) => void
  >();
  private readonly pendingInputs = new Map<string, (value: string) => void>();
  private sessionId: string = randomUUID();
  private autoApplyWrites = false;
  private expandTools = false;
  private maxReadLines = DEFAULT_MAX_READ_LINES;

  public constructor(
    private readonly post: (message: HostToWebview) => void,
    private readonly workspaceRoot: string,
    private readonly onConnectProvider?: () => void,
    /**
     * Asks the user to confirm deleting a session, returning whether to proceed.
     * Injected by the view provider so the bridge stays VSCode-agnostic; when
     * absent (e.g. in tests) deletion is treated as unconfirmed.
     */
    private readonly onConfirmDeleteSession?: (
      title: string
    ) => Promise<boolean>
  ) {
    // The extension host's cwd isn't the workspace, and anchoring to the
    // workspace root would scatter a debug.log into every project (and force the
    // user to hunt for the right window's copy). Write to the cache dir instead,
    // a single predictable home alongside config.json/sessions/models.json.
    // Clear stale entries from a previous run, mirroring the CLI's startup.
    setDebugLogDirectory(cacheDirectory());
    void deleteDebugLog();
  }

  /** Routes an inbound webview message to its handler. */
  public async handle(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case WebviewMessageType.Init:
        await this.sendSessionsList();
        return;
      case WebviewMessageType.Submit:
        await this.submit(message.content);
        return;
      case WebviewMessageType.Cancel:
        this.abortController?.abort();
        return;
      case WebviewMessageType.ApprovalResponse:
        this.pendingApprovals.get(message.id)?.(message.approved);
        this.pendingApprovals.delete(message.id);
        return;
      case WebviewMessageType.UserInputResponse:
        this.pendingInputs.get(message.id)?.(message.value);
        this.pendingInputs.delete(message.id);
        return;
      case WebviewMessageType.SelectModel:
        this.activeModel = message.modelId;
        await this.persistModelSelection(message.modelId, message.providerId);
        await this.switchToProvider(message.providerId);
        return;
      case WebviewMessageType.ConnectProvider:
        this.onConnectProvider?.();
        return;
      case WebviewMessageType.SelectProvider:
        await this.selectProvider(message.providerId);
        return;
      case WebviewMessageType.NewSession:
        await this.resetSession();
        return;
      case WebviewMessageType.ListSessions:
        await this.sendSessionsList();
        return;
      case WebviewMessageType.OpenSession:
        await this.openSession(message.sessionId);
        return;
      case WebviewMessageType.DeleteSession:
        await this.deleteSession(message.sessionId);
        return;
      case WebviewMessageType.ClearSessions:
        await this.clearAllSessions();
        return;
      case WebviewMessageType.ToggleAutoWrites:
        await this.toggleAutoWrites();
        return;
      case WebviewMessageType.ToggleExpandTools:
        await this.toggleExpandTools();
        return;
      case WebviewMessageType.SetReadLimit:
        await this.setReadLimit(message.lines);
        return;
    }
  }

  public dispose(): void {
    this.abortController?.abort();
    this.pendingApprovals.clear();
    this.pendingInputs.clear();
  }

  /** Builds (once) and returns the runtime services for this session. */
  private async ensureServices(): Promise<RuntimeServices> {
    if (!this.services) {
      this.services = await createRuntimeServices({
        workspaceRoot: this.workspaceRoot,
      });
    }
    return this.services;
  }

  /** Loads the session and pushes a full state snapshot to the webview. */
  private async sendReady(): Promise<void> {
    // Load persisted settings so the webview always starts in sync.
    const configDir = cacheDirectory();
    const globalConfig = await readGlobalConfig(configDir);
    this.autoApplyWrites = globalConfig.autoApplyWrites ?? false;
    this.expandTools = globalConfig.expandTools ?? false;
    this.maxReadLines = globalConfig.cache?.maxReadLines ?? DEFAULT_MAX_READ_LINES;

    let services: RuntimeServices;
    try {
      services = await this.ensureServices();
    } catch (error) {
      this.post({
        type: HostMessageType.Ready,
        providerId: undefined,
        activeModel: undefined,
        models: [],
        providers: [],
        messages: [],
        notice: `Failed to start ${APP_NAME}: ${errorMessage(error)}`,
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
      });
      return;
    }

    // Apply the current read limit to the runtime.
    services.setMaxReadLines(this.maxReadLines);

    const providers = services.allProviders.map((provider) => ({
      id: provider.providerId,
      name: provider.providerId,
    }));

    // With no configured provider the session is backed by a NullProvider whose
    // model listing is empty; surface a notice instead of letting startSession
    // throw, so the user sees how to proceed rather than a blank panel.
    if (!services.providerId) {
      this.post({
        type: HostMessageType.Ready,
        providerId: undefined,
        activeModel: undefined,
        models: [],
        providers,
        messages: [],
        notice:
          `No provider is configured. Connect one with the ${APP_NAME} CLI (or set the provider env vars), then reload this view.`,
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
      });
      return;
    }

    // On a fresh resume `this.activeModel` is unset, so fall back to the last
    // model the user picked. `lastProvider` is already restored as the active
    // provider via app-config, so only honour `lastModel` when it belongs to the
    // active provider — otherwise the model id wouldn't exist for this provider
    // and `startSession` would request a bogus model.
    if (
      !this.activeModel &&
      globalConfig.lastModel &&
      globalConfig.lastProvider === services.providerId
    ) {
      this.activeModel = globalConfig.lastModel;
    }

    try {
      const session = await services.chatSessionService.startSession({
        sessionId: this.sessionId,
        ...(this.activeModel ? { requestedModel: this.activeModel } : {}),
      });
      this.conversation = session.conversation;
      this.activeModel = session.activeModel;

      // Render immediately with just the active provider's models. Listing every
      // configured provider blocks on the slowest one — a single unreachable
      // host (a down remote, or a local provider that isn't running) would stall
      // the whole panel for up to the request timeout. The full list arrives via
      // a follow-up `ModelsUpdate` once the background fetch settles.
      this.models = session.availableModels;

      this.post({
        type: HostMessageType.Ready,
        providerId: services.providerId,
        activeModel: session.activeModel,
        models: this.models.map(toWebviewModel),
        providers,
        messages: toWebviewMessages(session.conversation),
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        ...(session.conversation.title !== undefined
          ? { sessionTitle: session.conversation.title }
          : {}),
      });

      void this.refreshAllModels(services, session.availableModels);
    } catch (error) {
      this.post({
        type: HostMessageType.Ready,
        providerId: services.providerId,
        activeModel: undefined,
        models: [],
        providers,
        messages: [],
        notice: `Could not load models for ${services.providerId}: ${errorMessage(error)}`,
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
      });
    }
  }

  /**
   * Lists every configured provider's models in the background and pushes the
   * merged result to the webview. The active provider's models (already shown by
   * `sendReady`) seed the list so the dropdown is never missing the live session,
   * and providers that fail (e.g. unreachable) are silently skipped.
   */
  private async refreshAllModels(
    services: RuntimeServices,
    activeModels: ModelInfo[]
  ): Promise<void> {
    const perProvider = await Promise.allSettled(
      services.allProviders.map((p) => p.listModels())
    );
    // Dedup on provider + id, not id alone: the same model id (e.g.
    // "gpt-5.4-mini") is offered by multiple providers (openai, copilot, ...)
    // and each is a distinct, separately selectable entry.
    const key = (m: ModelInfo): string => `${m.providerId}:${m.id}`;
    const seen = new Set<string>();
    const merged = perProvider.flatMap((result) =>
      result.status === 'fulfilled'
        ? result.value.filter((m) => {
            if (seen.has(key(m))) return false;
            seen.add(key(m));
            return true;
          })
        : []
    );
    for (const m of activeModels) {
      if (!seen.has(key(m))) {
        seen.add(key(m));
        merged.push(m);
      }
    }

    this.models = merged;
    this.post({
      type: HostMessageType.ModelsUpdate,
      models: merged.map(toWebviewModel),
    });
  }

  /** Runs one agent turn, streaming tokens, tool activity, and approvals. */
  private async submit(content: string): Promise<void> {
    if (this.abortController) {
      this.post({
        type: HostMessageType.Error,
        message: 'A turn is already in progress.',
      });
      return;
    }

    const services = await this.ensureServices();
    if (!this.conversation || !this.activeModel) {
      this.post({
        type: HostMessageType.Error,
        message: 'No active session. Configure a provider and reload.',
      });
      return;
    }

    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const result = await services.chatSessionService.submitMessage({
        conversation: this.conversation,
        model: this.activeModel,
        content,
        signal: abortController.signal,
        onToken: (token) =>
          this.post({ type: HostMessageType.Token, token }),
        onThinkingToken: (token) =>
          this.post({ type: HostMessageType.Thinking, token }),
        onToolActivity: (event) => this.postToolActivity(event),
        ...(!this.autoApplyWrites && {
          requestApproval: (request) => this.requestApproval(request),
        }),
        requestUserInput: (request) => this.requestUserInput(request),
        onTitle: (_sessionId, title) =>
          this.post({ type: HostMessageType.TitleUpdate, title }),
      });

      this.conversation = result.conversation;
      this.post({
        type: HostMessageType.TurnComplete,
        messages: toWebviewMessages(result.conversation),
        ...(result.usage ? { usage: result.usage } : {}),
      });
    } catch (error) {
      const aborted = isAbortError(error);
      this.post({
        type: HostMessageType.Error,
        message: aborted ? 'Turn cancelled.' : errorMessage(error),
        aborted,
      });
    } finally {
      this.abortController = undefined;
      // Any approval/input prompts still open belong to the turn that just
      // ended; drop them so a late webview reply can't resolve a stale promise.
      this.pendingApprovals.clear();
      this.pendingInputs.clear();
    }
  }

  private postToolActivity(event: ToolActivityEvent): void {
    this.post({
      type: HostMessageType.ToolActivity,
      phase: event.phase === 'start' ? ToolPhase.Start : ToolPhase.End,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      view: toToolView(event.view),
      ...(event.result
        ? {
            isError: event.result.isError ?? false,
            resultPreview: truncate(event.result.content, RESULT_PREVIEW_LIMIT),
          }
        : {}),
    });
  }

  private requestApproval(request: ToolApprovalRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = randomUUID();
      this.pendingApprovals.set(id, resolve);
      this.post({
        type: HostMessageType.ApprovalRequest,
        id,
        toolName: request.toolName,
        view: toToolView(request),
      });
    });
  }

  private requestUserInput(request: UserQuestionRequest): Promise<string> {
    return new Promise<string>((resolve) => {
      const id = randomUUID();
      this.pendingInputs.set(id, resolve);
      this.post({
        type: HostMessageType.UserInputRequest,
        id,
        question: request.question,
        ...(request.options ? { options: request.options } : {}),
      });
    });
  }

  private async sendSessionsList(): Promise<void> {
    try {
      const services = await this.ensureServices();
      const summaries = await services.chatSessionService.listSessions();
      this.post({
        type: HostMessageType.SessionsList,
        sessions: summaries.map((s) => ({
          sessionId: s.sessionId,
          ...(s.title !== undefined ? { title: s.title } : {}),
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
        })),
      });
    } catch (error) {
      this.post({
        type: HostMessageType.SessionsList,
        sessions: [],
      });
    }
  }

  private async openSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.conversation = undefined;
    await this.sendReady();
  }

  private async deleteSession(sessionId: string): Promise<void> {
    const services = await this.ensureServices();

    // Confirm against the session's title (falling back to a generic label) so
    // the dialog names what's about to be removed.
    let title = 'this session';
    try {
      const summaries = await services.chatSessionService.listSessions();
      const match = summaries.find((s) => s.sessionId === sessionId);
      if (match?.title) title = `"${match.title}"`;
    } catch {
      // Listing failed — fall back to the generic label rather than blocking.
    }

    const confirmed = (await this.onConfirmDeleteSession?.(title)) ?? false;
    if (!confirmed) return;

    try {
      await services.chatSessionService.clearSession(sessionId);
    } catch (error) {
      this.post({ type: HostMessageType.Error, message: errorMessage(error) });
      return;
    }

    // If the deleted session was the one loaded, drop it so reopening the chat
    // starts fresh rather than resurrecting the cleared conversation.
    if (sessionId === this.sessionId) {
      this.sessionId = randomUUID();
      this.conversation = undefined;
    }

    await this.sendSessionsList();
  }

  private async clearAllSessions(): Promise<void> {
    const services = await this.ensureServices();

    let summaries;
    try {
      summaries = await services.chatSessionService.listSessions();
    } catch (error) {
      this.post({ type: HostMessageType.Error, message: errorMessage(error) });
      return;
    }

    if (summaries.length === 0) return;

    const label = `all ${summaries.length} session${summaries.length === 1 ? '' : 's'}`;
    const confirmed = (await this.onConfirmDeleteSession?.(label)) ?? false;
    if (!confirmed) return;

    await Promise.allSettled(
      summaries.map((s) => services.chatSessionService.clearSession(s.sessionId))
    );

    // The open session was almost certainly among those cleared; start fresh so
    // the chat view doesn't resurrect a deleted conversation.
    this.sessionId = randomUUID();
    this.conversation = undefined;

    await this.sendSessionsList();
  }

  private async switchToProvider(providerId: string): Promise<void> {
    const services = this.services;
    if (!services || services.providerId === providerId) return;
    try {
      const provider = services.createProvider(providerId as ProviderId);
      services.chatSessionService.switchProvider(provider);
      services.providerId = providerId as ProviderId;
    } catch {
      // Switch failed — the next turn will surface the error naturally.
    }
  }

  private async persistModelSelection(
    modelId: string,
    providerId: string
  ): Promise<void> {
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      lastModel: modelId,
      lastProvider: providerId,
    });
  }

  private async toggleAutoWrites(): Promise<void> {
    this.autoApplyWrites = !this.autoApplyWrites;
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      autoApplyWrites: this.autoApplyWrites,
    });
  }

  private async toggleExpandTools(): Promise<void> {
    this.expandTools = !this.expandTools;
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      expandTools: this.expandTools,
    });
  }

  private async setReadLimit(lines: number): Promise<void> {
    this.maxReadLines = lines;
    const services = this.services;
    if (services) {
      services.setMaxReadLines(lines);
    }
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      cache: { ...config.cache, maxReadLines: lines },
    });
  }

  private async selectProvider(providerId: string): Promise<void> {
    const services = await this.ensureServices();
    let provider: ProviderClient;
    try {
      provider = services.createProvider(providerId as ProviderId);
    } catch (error) {
      this.post({ type: HostMessageType.Error, message: errorMessage(error) });
      return;
    }

    services.chatSessionService.switchProvider(provider);
    services.providerId = providerId as ProviderId;
    // Clear the requested model so the new provider's default is resolved.
    this.activeModel = undefined;
    await this.sendReady();
  }

  private async resetSession(): Promise<void> {
    const services = this.services;
    if (services && this.conversation) {
      try {
        await services.chatSessionService.clearSession(this.sessionId);
      } catch {
        // A fresh session id sidesteps a clear failure; the old file is orphaned
        // but never read again.
      }
    }
    this.sessionId = randomUUID();
    this.conversation = undefined;
    await this.sendReady();
  }
}

function toWebviewModel(model: ModelInfo): WebviewModel {
  const entry = PROVIDER_BY_ID[model.providerId];
  const result: WebviewModel = {
    id: model.id,
    displayName: model.displayName,
    providerId: model.providerId,
    providerName: entry?.name ?? model.providerId,
  };
  if (model.contextWindow != null) {
    result.contextWindow = model.contextWindow;
  }
  if (model.pricing) {
    result.inputCostPerM = model.pricing.inputPerToken * 1_000_000;
    result.outputCostPerM = model.pricing.outputPerToken * 1_000_000;
  } else if (entry?.local) {
    result.local = true;
  }
  return result;
}

function toToolView(view: ToolInvocationView): WebviewToolView {
  return {
    title: view.title,
    ...(view.preview ? { preview: view.preview } : {}),
    ...(view.diff ? { diff: view.diff } : {}),
  };
}

/**
 * Flattens a persisted conversation into the transcript the webview renders.
 * System messages are internal; assistant messages that only carried tool calls
 * (no prose) are dropped because their work is shown as tool activity instead.
 */
function toWebviewMessages(conversation: Conversation): WebviewMessage[] {
  const result: WebviewMessage[] = [];
  for (const message of conversation.messages) {
    if (message.role === 'system') continue;
    if (message.role === 'assistant' && !message.content.trim()) continue;
    result.push({
      id: message.id,
      role: toWebviewRole(message.role),
      content: message.content,
      ...(message.role === 'tool' && message.name
        ? { toolName: message.name }
        : {}),
    });
  }
  return result;
}

function toWebviewRole(role: MessageRole): WebviewRole {
  switch (role) {
    case 'user':
      return WebviewRole.User;
    case 'assistant':
      return WebviewRole.Assistant;
    case 'tool':
      return WebviewRole.Tool;
    case 'system':
      return WebviewRole.System;
  }
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (truncated)`;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  // Node's undici fetch throws a bare `TypeError: fetch failed` and stashes the
  // real transport reason (DNS, TLS, ECONNREFUSED, proxy, ...) on `.cause`,
  // sometimes nested one level deeper. The CLI runs on Bun whose fetch surfaces
  // this differently, which is why the same failure reads as an opaque "fetch
  // failed" only in the extension. Walk the cause chain so the user sees why.
  const parts: string[] = [error.message];
  let cause: unknown = (error as { cause?: unknown }).cause;
  const seen = new Set<unknown>([error]);
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    const code = (cause as { code?: string }).code;
    parts.push(code ? `${cause.message} (${code})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(': ');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
