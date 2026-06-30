import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  createConversation,
  type Conversation,
} from '@core/domain/conversation';
import { APP_NAME } from '@core/branding';
import type { MessageRole } from '@core/domain/message';
import type {
  ModelInfo,
  ModelReasoning,
  ProviderClient,
  ReasoningEffortChoice,
  TokenUsage,
} from '@core/ports/chat-model';
import { ProviderId, PROVIDER_BY_ID } from '@core/ports/provider-catalog';
import {
  describeTool,
  type ToolApprovalRequest,
  type ToolActivityEvent,
} from '@core/application/chat-session-service';
import type { ToolInvocationView, UserQuestionRequest } from '@core/ports/tool';
import { ToolName } from '@core/domain/tool-name';
import { cacheDirectory } from '@core/application/cache-dir';
import {
  deleteDebugLog,
  setDebugLogDirectory,
} from '@core/application/debug-log';
import { DEFAULT_MAX_READ_LINES } from '@core/application/read-window';
import { DEFAULT_MAX_HISTORY_MESSAGES } from '@core/application/history-window';
import {
  readGlobalConfig,
  writeGlobalConfig,
  type GlobalConfig,
} from '@runtime/persistence/global-config';
import {
  createRuntimeServices,
  type RuntimeServices,
} from '@runtime/bootstrap/create-services';

import { parseRemovedPaths } from '@ext/host/parse-removed-paths';

import {
  HostMessageType,
  ToolPhase,
  WebviewMessageType,
  WebviewRole,
  type HostToWebview,
  type WebviewMessage,
  type WebviewStats,
  type WebviewToHost,
  type WebviewModel,
  type WebviewReasoningChoice,
  type WebviewReasoningEffort,
  type WebviewToolView,
  type WebviewUsage,
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
  // Tool views captured live (keyed by tool-call id), kept so the rebuilt
  // transcript can reuse the pre-edit diff. Recomputing it afterward fails for
  // edits/patches: the file is already changed, so the original text is gone.
  private readonly toolViewsByCallId = new Map<string, WebviewToolView>();
  // Files a bash call is about to delete, with their pre-deletion content,
  // keyed by tool-call id. Captured when the call starts (before it runs) so a
  // deletion can be shown in the changes panel and reverted by restoring the
  // content. Resolved and cleared when the call ends.
  private readonly capturedDeletions = new Map<
    string,
    Array<{ path: string; oldText: string }>
  >();
  private sessionId: string = randomUUID();
  private autoApplyWrites = false;
  private expandTools = false;
  private maxReadLines = DEFAULT_MAX_READ_LINES;
  // 0 means "off" — the full conversation is sent without trimming.
  private maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES;
  private thinkingCollapsed = false;
  // The user's chosen reasoning effort per model, nested by provider id (e.g.
  // `{ openrouter: { "openai/gpt-5": "high" } }`). Mirrors the CLI's per-model
  // store; a model absent here uses its default effort.
  private reasoningEffortByModel: Record<
    string,
    Record<string, WebviewReasoningChoice | undefined> | undefined
  > = {};
  // Cumulative token usage across the session, mirroring the CLI's metrics
  // footer (ctx / cached / new / out / cost). Reset whenever the conversation is.
  private cumulativeUsage: Required<WebviewUsage> = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cost: 0,
  };
  // Every completed turn's tok/s; the session average is their mean.
  private tokensPerSecondSamples: number[] = [];

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
    ) => Promise<boolean>,
    /** Reveals the Settings editor tab; injected by the view provider. */
    private readonly onOpenSettings?: () => void,
    /** Opens a workspace file in the editor; injected by the view provider. */
    private readonly onOpenFile?: (absolutePath: string) => void
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
      case WebviewMessageType.SetReasoningEffort:
        await this.setReasoningEffort(
          message.providerId,
          message.modelId,
          message.effort
        );
        return;
      case WebviewMessageType.ConnectProvider:
        this.onConnectProvider?.();
        return;
      case WebviewMessageType.OpenSettings:
        this.onOpenSettings?.();
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
      case WebviewMessageType.SetHistoryLimit:
        await this.setHistoryLimit(message.count);
        return;
      case WebviewMessageType.ToggleThinkingCollapsed:
        await this.toggleThinkingCollapsed();
        return;
      case WebviewMessageType.RevertFile:
        await this.revertFile(message.path, message.oldText, message.created);
        return;
      case WebviewMessageType.OpenFile:
        this.openFile(message.path);
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
    this.maxReadLines =
      globalConfig.cache?.maxReadLines ?? DEFAULT_MAX_READ_LINES;
    this.maxHistoryMessages =
      globalConfig.cache?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
    this.thinkingCollapsed = globalConfig.thinkingCollapsed ?? false;
    // The config stores the same string values under @core's ReasoningEffort
    // enum type; the webview protocol re-declares them as string literals.
    this.reasoningEffortByModel = (globalConfig.reasoningEffortByModel ??
      {}) as Record<
      string,
      Record<string, WebviewReasoningChoice | undefined> | undefined
    >;

    let services: RuntimeServices;
    try {
      services = await this.ensureServices();
    } catch (error) {
      this.post({
        type: HostMessageType.Ready,
        providerId: undefined,
        activeModel: undefined,
        models: [],
        messages: [],
        notice: `Failed to start ${APP_NAME}: ${errorMessage(error)}`,
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        reasoningEffortByModel: this.reasoningEffortByModel,
      });
      return;
    }

    // Apply the current read and history limits to the runtime.
    services.setMaxReadLines(this.maxReadLines);
    services.setMaxHistoryMessages(this.maxHistoryMessages);

    // With no configured provider the session is backed by a NullProvider whose
    // model listing is empty; surface a notice instead of letting startSession
    // throw, so the user sees how to proceed rather than a blank panel.
    if (!services.providerId) {
      this.post({
        type: HostMessageType.Ready,
        providerId: undefined,
        activeModel: undefined,
        models: [],
        messages: [],
        notice: `No provider is configured. Connect one with the ${APP_NAME} CLI (or set the provider env vars), then reload this view.`,
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        reasoningEffortByModel: this.reasoningEffortByModel,
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
        messages: await toWebviewMessages(
          session.conversation,
          services,
          this.toolViewsByCallId
        ),
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        reasoningEffortByModel: this.reasoningEffortByModel,
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
        messages: [],
        notice: `Could not load models for ${services.providerId}: ${errorMessage(error)}`,
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        reasoningEffortByModel: this.reasoningEffortByModel,
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

    // Timing for the TTFT / tok-s footer. `firstTokenMs` is stamped by the first
    // streamed token (visible or thinking), matching the CLI's measurement.
    const startMs = Date.now();
    let firstTokenMs: number | null = null;
    const markFirstToken = (): void => {
      if (firstTokenMs === null) firstTokenMs = Date.now();
    };

    try {
      const reasoningEffort = this.effectiveEffortForActiveModel();
      const result = await services.chatSessionService.submitMessage({
        conversation: this.conversation,
        model: this.activeModel,
        content,
        // The webview-flavored choice carries the same string values as @core's
        // ReasoningEffortChoice; bridge the nominal enum/literal mismatch here.
        ...(reasoningEffort
          ? { reasoningEffort: reasoningEffort as ReasoningEffortChoice }
          : {}),
        signal: abortController.signal,
        onToken: (token) => {
          markFirstToken();
          this.post({ type: HostMessageType.Token, token });
        },
        onThinkingToken: (token) => {
          markFirstToken();
          this.post({ type: HostMessageType.Thinking, token });
        },
        onUsage: (stepUsage) => {
          // Accumulate each response's usage as it arrives and push a live
          // snapshot, so the footer metrics track the turn in progress.
          this.accumulateUsage(stepUsage);
          this.post({
            type: HostMessageType.UsageUpdate,
            usage: { ...this.cumulativeUsage },
          });
        },
        onToolActivity: (event) => this.postToolActivity(event),
        ...(!this.autoApplyWrites && {
          requestApproval: (request) => this.requestApproval(request),
        }),
        requestUserInput: (request) => this.requestUserInput(request),
        onTitle: (_sessionId, title) =>
          this.post({ type: HostMessageType.TitleUpdate, title }),
      });

      const endMs = Date.now();
      this.conversation = result.conversation;

      // Usage was already folded in live via onUsage above; don't add it again.

      let stats: WebviewStats | undefined;
      if (firstTokenMs !== null) {
        const ttftMs = Math.max(firstTokenMs - startMs, 0);
        const genSeconds = Math.max(endMs - firstTokenMs, 1) / 1000;
        const tokensPerSecond = (result.usage?.outputTokens ?? 0) / genSeconds;
        this.tokensPerSecondSamples.push(tokensPerSecond);
        stats = {
          ttftMs,
          tokensPerSecond,
          avgTokensPerSecond: average(this.tokensPerSecondSamples),
        };
      }

      const hasUsage =
        this.cumulativeUsage.inputTokens > 0 ||
        this.cumulativeUsage.outputTokens > 0;
      this.post({
        type: HostMessageType.TurnComplete,
        messages: await toWebviewMessages(
          result.conversation,
          services,
          this.toolViewsByCallId
        ),
        ...(hasUsage ? { usage: { ...this.cumulativeUsage } } : {}),
        ...(stats ? { stats } : {}),
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

  /**
   * Folds one turn's usage into the running session totals, deriving cost from
   * the active model's pricing when the provider didn't report it (mirrors the
   * CLI's metrics footer).
   */
  private accumulateUsage(usage: TokenUsage): void {
    const cost = usage.cost ?? this.estimateCost(usage);
    this.cumulativeUsage = {
      inputTokens: this.cumulativeUsage.inputTokens + usage.inputTokens,
      outputTokens: this.cumulativeUsage.outputTokens + usage.outputTokens,
      cachedTokens: this.cumulativeUsage.cachedTokens + usage.cachedTokens,
      cost: this.cumulativeUsage.cost + cost,
    };
  }

  private estimateCost(usage: TokenUsage): number {
    const pricing = this.models.find((m) => m.id === this.activeModel)?.pricing;
    if (!pricing) return 0;
    return (
      usage.inputTokens * pricing.inputPerToken +
      usage.outputTokens * pricing.outputPerToken +
      usage.cachedTokens * (pricing.cacheReadPerToken ?? pricing.inputPerToken)
    );
  }

  /** Clears the running usage/stats totals; called whenever the conversation is. */
  private resetMetrics(): void {
    this.cumulativeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cost: 0,
    };
    this.tokensPerSecondSamples = [];
    this.toolViewsByCallId.clear();
    this.capturedDeletions.clear();
  }

  private postToolActivity(event: ToolActivityEvent): void {
    const view = toToolView(event.view);

    // Bash is the only path to a file deletion (there's no delete tool), and it
    // emits no diff. Capture the soon-to-be-deleted content before the command
    // runs, then synthesize a deletion diff once the file is gone so it shows in
    // the changes panel like any other edit.
    if (event.toolName === ToolName.Bash) {
      if (event.phase === 'start') {
        this.captureDeletionCandidates(event.toolCallId, view.preview);
      } else {
        const diff = this.resolveDeletionDiff(event.toolCallId);
        if (diff) view.diff = diff;
      }
    }

    // Capture the live view (the start phase carries the pre-edit diff) so the
    // post-turn transcript rebuild can reuse it instead of recomputing against
    // the already-edited file, which would drop the diff entirely. A bash
    // deletion diff is only known on `end`, so let that overwrite the cached
    // start view.
    if (
      event.phase === 'start' ||
      !this.toolViewsByCallId.has(event.toolCallId) ||
      (event.phase === 'end' && view.diff)
    ) {
      this.toolViewsByCallId.set(event.toolCallId, view);
    }
    this.post({
      type: HostMessageType.ToolActivity,
      phase: event.phase === 'start' ? ToolPhase.Start : ToolPhase.End,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      view,
      ...(event.result
        ? {
            isError: event.result.isError ?? false,
            resultPreview: truncate(event.result.content, RESULT_PREVIEW_LIMIT),
          }
        : {}),
    });
  }

  /**
   * Reads, synchronously, the content of every file a bash command is about to
   * delete. Runs in the tool's `start` callback, which fires before the command
   * executes, so the content is captured while the file still exists. Paths
   * outside the workspace, directories, and anything needing shell expansion are
   * skipped — only literal files we can later restore are kept.
   */
  private captureDeletionCandidates(
    toolCallId: string,
    command: string | undefined
  ): void {
    if (!command) return;
    const captured: Array<{ path: string; oldText: string }> = [];
    for (const rawPath of parseRemovedPaths(command)) {
      const absolute = resolve(this.workspaceRoot, rawPath);
      const rel = relative(this.workspaceRoot, absolute);
      if (rel.startsWith('..') || isAbsolute(rel)) continue;
      try {
        if (!statSync(absolute).isFile()) continue;
        captured.push({
          path: rel.split('\\').join('/'),
          oldText: readFileSync(absolute, 'utf8'),
        });
      } catch {
        // Unreadable, missing, or a directory — nothing we can restore later.
      }
    }
    if (captured.length > 0) this.capturedDeletions.set(toolCallId, captured);
  }

  /**
   * After a bash command finishes, turns the first captured file that's now gone
   * into a deletion diff (old content → empty). Only one diff fits per tool call,
   * so a command deleting several files surfaces the first; the rest are dropped.
   */
  private resolveDeletionDiff(
    toolCallId: string
  ): { path: string; oldText: string; newText: string } | undefined {
    const captured = this.capturedDeletions.get(toolCallId);
    this.capturedDeletions.delete(toolCallId);
    if (!captured) return undefined;
    const deleted = captured.find(
      (entry) => !existsSync(resolve(this.workspaceRoot, entry.path))
    );
    if (!deleted) return undefined;
    return { path: deleted.path, oldText: deleted.oldText, newText: '' };
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
        hasConnectedProvider: services.allProviders.length > 0,
      });
    } catch (error) {
      this.post({
        type: HostMessageType.SessionsList,
        sessions: [],
        hasConnectedProvider: false,
      });
    }
  }

  private async openSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.conversation = undefined;
    this.resetMetrics();
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
      this.resetMetrics();
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
      summaries.map((s) =>
        services.chatSessionService.clearSession(s.sessionId)
      )
    );

    // The open session was almost certainly among those cleared; start fresh so
    // the chat view doesn't resurrect a deleted conversation.
    this.sessionId = randomUUID();
    this.conversation = undefined;
    this.resetMetrics();

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

  /**
   * The reasoning effort actually sent for the active model: the stored choice,
   * or the model's default when the user hasn't picked one. Returns undefined
   * for models that don't advertise reasoning (the parameter is then omitted).
   * Mirrors the CLI's `effectiveEffort`.
   */
  private effectiveEffortForActiveModel(): WebviewReasoningChoice | undefined {
    const model = this.models.find((m) => m.id === this.activeModel);
    return effectiveEffort(
      model?.reasoning,
      model
        ? this.reasoningEffortByModel[model.providerId]?.[model.id]
        : undefined
    );
  }

  private async setReasoningEffort(
    providerId: string,
    modelId: string,
    effort: WebviewReasoningChoice
  ): Promise<void> {
    this.reasoningEffortByModel = {
      ...this.reasoningEffortByModel,
      [providerId]: {
        ...this.reasoningEffortByModel[providerId],
        [modelId]: effort,
      },
    };
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      reasoningEffortByModel: this
        .reasoningEffortByModel as NonNullable<
        GlobalConfig['reasoningEffortByModel']
      >,
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

  // 0 (or less) turns context window trimming off — the whole conversation is sent.
  private async setHistoryLimit(count: number): Promise<void> {
    this.maxHistoryMessages = count;
    const services = this.services;
    if (services) {
      services.setMaxHistoryMessages(count);
    }
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      cache: { ...config.cache, maxHistoryMessages: count },
    });
  }

  private async toggleThinkingCollapsed(): Promise<void> {
    this.thinkingCollapsed = !this.thinkingCollapsed;
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      thinkingCollapsed: this.thinkingCollapsed,
    });
  }

  /**
   * Undoes a file's session changes from the changes panel: restores the
   * pre-session baseline, or deletes the file when it was created this session.
   * The diff path is workspace-relative; it's resolved against the workspace
   * root and rejected if it escapes it, so a malformed path can't write outside
   * the project.
   */
  private async revertFile(
    path: string,
    oldText: string,
    created: boolean
  ): Promise<void> {
    const target = resolve(this.workspaceRoot, path);
    const rel = relative(this.workspaceRoot, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      this.post({
        type: HostMessageType.FileReverted,
        path,
        ok: false,
        message: `Refusing to revert a path outside the workspace: ${path}`,
      });
      return;
    }

    try {
      if (created) {
        // The file didn't exist before this session; undoing means removing it.
        // `force` makes a missing file (already deleted by the user) a no-op.
        await rm(target, { force: true });
      } else {
        await writeFile(target, oldText, 'utf8');
      }
      this.post({ type: HostMessageType.FileReverted, path, ok: true });
    } catch (error) {
      this.post({
        type: HostMessageType.FileReverted,
        path,
        ok: false,
        message: `Couldn't undo ${path}: ${errorMessage(error)}`,
      });
    }
  }

  /**
   * Reveals a changed file in the editor. The path is workspace-relative and is
   * resolved + bounds-checked against the workspace root, mirroring
   * {@link revertFile}, so a malformed path can't open something outside it.
   */
  private openFile(path: string): void {
    const target = resolve(this.workspaceRoot, path);
    const rel = relative(this.workspaceRoot, target);
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    this.onOpenFile?.(target);
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

  /**
   * Drops cached services so the next chat interaction reloads providers from
   * config. Called by the view provider after the Settings tab connects or
   * disconnects a provider, so the live sidebar reflects the change. If the
   * removed provider backed the open session, refresh the view immediately.
   */
  public async refreshProviders(): Promise<void> {
    const previousProvider = this.services?.providerId;
    this.services = undefined;

    if (!this.conversation) return;

    // The active provider may have been disconnected; reload from config and
    // re-render. Clear the model so a now-missing provider's model isn't
    // requested.
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    const stillConfigured = Object.keys(config.providers ?? {}).includes(
      previousProvider ?? ''
    );
    if (!stillConfigured) {
      this.conversation = undefined;
      this.activeModel = undefined;
    }
    await this.sendReady();
  }

  private async resetSession(): Promise<void> {
    // Start a new session without touching the existing one — it's already
    // persisted and should remain visible in the sessions list.
    this.sessionId = randomUUID();
    this.resetMetrics();

    // Fast path: a new session is just an empty conversation reusing the model
    // list and active model we already hold. Falling through to `sendReady`
    // would re-run `startSession`, which awaits `provider.listModels()` — a live
    // network call for local providers (Ollama/LM Studio), a disk read+parse
    // otherwise — and only renders the blank chat once that resolves, the lag
    // the user sees when clicking "+". Reuse the cached state so it shows at once.
    if (this.services?.providerId && this.activeModel && this.models.length > 0) {
      this.conversation = createConversation(this.sessionId);
      this.post({
        type: HostMessageType.Ready,
        providerId: this.services.providerId,
        activeModel: this.activeModel,
        models: this.models.map(toWebviewModel),
        messages: [],
        autoApplyWrites: this.autoApplyWrites,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        reasoningEffortByModel: this.reasoningEffortByModel,
      });
      return;
    }

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
  if (model.reasoning) {
    // The enum values are the same strings the protocol re-declares as literals.
    result.reasoning = {
      effortLevels: model.reasoning.effortLevels as WebviewReasoningEffort[],
      mandatory: model.reasoning.mandatory,
      ...(model.reasoning.defaultEffort
        ? {
            defaultEffort: model.reasoning
              .defaultEffort as WebviewReasoningEffort,
          }
        : {}),
    };
  }
  return result;
}

/**
 * The reasoning effort actually sent for a model: the stored choice, or the
 * model's default when the user hasn't picked one. Returns undefined for models
 * that don't advertise reasoning. Mirrors the CLI's `effectiveEffort`.
 */
function effectiveEffort(
  reasoning: ModelReasoning | undefined,
  stored: WebviewReasoningChoice | undefined
): WebviewReasoningChoice | undefined {
  if (!reasoning) return undefined;
  if (stored) return stored;
  return (reasoning.defaultEffort ?? reasoning.effortLevels[0]) as
    | WebviewReasoningChoice
    | undefined;
}

function toToolView(view: ToolInvocationView): WebviewToolView {
  return {
    title: view.title,
    ...(view.preview ? { preview: view.preview } : {}),
    ...(view.diff ? { diff: view.diff } : {}),
    ...(view.path ? { path: view.path } : {}),
  };
}

/**
 * Flattens a persisted conversation into the transcript the webview renders.
 * System messages are internal; assistant messages that only carried tool calls
 * (no prose) are dropped because their work is shown as tool activity instead.
 */
export async function toWebviewMessages(
  conversation: Conversation,
  services?: RuntimeServices,
  cachedToolViews?: ReadonlyMap<string, WebviewToolView>
): Promise<WebviewMessage[]> {
  const result: WebviewMessage[] = [];
  const toolViewsByCallId = new Map<string, WebviewToolView>();
  for (const message of conversation.messages) {
    if (message.role === 'system') continue;
    if (message.role === 'assistant' && message.toolCalls?.length && services) {
      for (const toolCall of message.toolCalls) {
        // Prefer the view captured while the tool ran: it holds the pre-edit
        // diff, which can't be recomputed once the file has changed on disk.
        const cached = cachedToolViews?.get(toolCall.id);
        if (cached) {
          toolViewsByCallId.set(toolCall.id, cached);
          continue;
        }
        const tool = services.toolRegistry.get(toolCall.name);
        if (!tool) continue;
        try {
          const view = await describeTool(tool, toolCall.arguments, {
            workspaceRoot: services.workspaceRoot,
          });
          toolViewsByCallId.set(toolCall.id, toToolView(view));
        } catch {
          toolViewsByCallId.set(toolCall.id, { title: toolCall.name });
        }
      }
    }
    if (
      message.role === 'assistant' &&
      !message.content.trim() &&
      !message.thinking
    ) {
      continue;
    }
    result.push({
      id: message.id,
      role: toWebviewRole(message.role),
      content: message.content,
      ...(message.role === 'tool' && message.name
        ? { toolName: message.name }
        : {}),
      ...(message.role === 'tool' && message.toolCallId
        ? { toolView: toolViewsByCallId.get(message.toolCallId) }
        : {}),
      ...(message.thinking ? { thinking: message.thinking } : {}),
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

function average(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
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
