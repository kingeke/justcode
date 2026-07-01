import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  createConversation,
  type Conversation,
} from '@core/domain/conversation';
import { APP_NAME } from '@core/branding';
import {
  createMessage,
  type MessageAttachment,
  type MessageRole,
} from '@core/domain/message';
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
import { sessionFilePath } from '@runtime/persistence/file-conversation-repository';
import type { McpServerLoadInfo } from '@runtime/mcp/load-mcp-tools';
import { clearModelsCache } from '@providers/http/models-cache';

import { parseRemovedPaths } from '@ext/host/parse-removed-paths';
import {
  readResolvedFiles,
  writeResolvedFiles,
  deleteResolvedFiles,
  pruneResolvedFiles,
} from '@ext/host/resolved-files-store';
import {
  readToolViews,
  writeToolViews,
  deleteToolViews,
  pruneToolViews,
} from '@ext/host/tool-views-store';

import {
  HostMessageType,
  ToolPhase,
  WebviewMessageType,
  WebviewRole,
  type HostToWebview,
  type WebviewImage,
  type WebviewMessage,
  type WebviewStats,
  type WebviewToHost,
  type WebviewModel,
  type WebviewProviderError,
  type WebviewReasoningChoice,
  type WebviewReasoningEffort,
  type WebviewTool,
  type WebviewToolView,
  type WebviewUsage,
  type WebviewMode,
} from '@ext/shared/protocol';
import {
  addCustomMode,
  BUILD_MODE_ID,
  eagerToolsForMode,
  isKnownMode,
  listModes,
  resolveModeSystemPrompt,
  type CustomModeConfig,
} from '@core/domain/chat-mode';

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
  // Providers whose last model-list fetch failed, mirrored to the picker so an
  // unreachable provider surfaces its error instead of silently disappearing.
  private providerErrors: WebviewProviderError[] = [];
  // The webview's current text follow-up queue, mirrored here so the running
  // turn can steer on it. Drained (and cleared) a step at a time by the agent
  // loop via `drainSteering`; reset when a fresh turn starts.
  private steeringQueue: { id: string; content: string }[] = [];
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
  private autoApprove = false;
  private expandTools = false;
  private maxReadLines = DEFAULT_MAX_READ_LINES;
  // 0 means "off" — the full conversation is sent without trimming.
  private maxHistoryMessages = DEFAULT_MAX_HISTORY_MESSAGES;
  private thinkingCollapsed = false;
  // When true (default), local providers refetch their model list every load;
  // when false they use the once-a-day cache. Applied to the live runtime via
  // `setLocalModelAutoRefresh` so toggling takes effect without a reload.
  private localModelAutoRefresh = true;
  // When true (default), the `lazy_load_tools` gateway is on: the model unlocks
  // the full tool set by calling lazy_load_tools. When false, all tools are sent
  // up front. Applied to the live runtime via `setLazyToolLoading`.
  private lazyToolLoading = true;
  // Names of tools the user has turned off. Applied to the live runtime via
  // `setDisabledTools` so toggling takes effect on the next turn without a reload.
  private disabledTools: string[] = [];
  // The toggleable tool catalog, populated from the runtime once services exist;
  // sent to the webview in every snapshot so the manage-tools popup can render.
  private manageableTools: WebviewTool[] = [];
  // Whether MCP servers are still connecting in the background. Drives the
  // webview's "loading MCP servers" spinner; cleared when the load callback fires.
  private mcpLoading = false;
  // Chat modes (built-in + custom) and the active one. The active mode's system
  // prompt is applied to the runtime; custom modes live in global config.
  private modes: WebviewMode[] = [];
  private activeModeId: string = BUILD_MODE_ID;
  // The user-editable base (Build/agent) prompt and custom-mode definitions,
  // cached from config so a mode switch can resolve + apply the new system prompt
  // synchronously — before the next queued message (e.g. the Submit that follows
  // "Start implementation") is handled — rather than after an async config read.
  private agentPrompt: string | undefined;
  private customModesConfig: Record<string, CustomModeConfig> = {};
  // Workspace-relative path of the file open in the editor, which `@currentfile`
  // resolves to. Kept in sync by the view provider as the active editor changes;
  // re-applied to the runtime whenever services are (re)created.
  private currentFile: string | undefined;
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
    /**
     * Reveals the Settings editor tab; injected by the view provider. An
     * optional section focuses a specific tab (e.g. `'mcp'` for MCP servers).
     */
    private readonly onOpenSettings?: (section?: 'mcp') => void,
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
        await this.submit(message.content, message.images);
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
      case WebviewMessageType.RefreshModels:
        await this.refreshModels();
        return;
      case WebviewMessageType.ViewChatLog:
        await this.viewChatLog();
        return;
      case WebviewMessageType.SaveResolvedFiles:
        await writeResolvedFiles(
          cacheDirectory(),
          this.sessionId,
          message.resolved
        );
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
      case WebviewMessageType.ToggleAutoApprove:
        await this.toggleAutoApprove();
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
      case WebviewMessageType.ToggleLocalModelAutoRefresh:
        await this.toggleLocalModelAutoRefresh();
        return;
      case WebviewMessageType.ToggleLazyToolLoading:
        await this.toggleLazyToolLoading();
        return;
      case WebviewMessageType.SetDisabledTools:
        await this.setDisabledTools(message.names);
        return;
      case WebviewMessageType.SelectMode:
        await this.selectMode(message.modeId);
        return;
      case WebviewMessageType.CreateMode:
        await this.createMode(message.name, message.systemPrompt);
        return;
      case WebviewMessageType.EditPlan:
        await this.editPlan(message.content);
        return;
      case WebviewMessageType.RevertFile:
        await this.revertFile(message.path, message.oldText, message.created);
        return;
      case WebviewMessageType.OpenFile:
        this.openFile(message.path);
        return;
      case WebviewMessageType.OpenMcpConfig:
        // Open the Settings tab's MCP section, where the user edits mcp.json in a
        // textarea and saves — which reconnects servers live (see reloadMcp).
        this.onOpenSettings?.('mcp');
        return;
      case WebviewMessageType.SyncSteeringQueue:
        // Mirror the webview's editable follow-up queue so the in-flight turn
        // can fold it in at the next step. Replace wholesale — the webview sends
        // the full current snapshot on every change (queue/edit/delete).
        this.steeringQueue = message.messages;
        return;
      case WebviewMessageType.RequestWorkspaceFiles:
        await this.sendWorkspaceFiles();
        return;
      case WebviewMessageType.RequestFileSymbols:
        await this.sendFileSymbols(message.path);
        return;
    }
  }

  /** Serves the workspace file list for the composer's `@file` completions. */
  private async sendWorkspaceFiles(): Promise<void> {
    try {
      const services = await this.ensureServices();
      const files = await services.promptAttachmentService.listFiles();
      this.post({ type: HostMessageType.WorkspaceFiles, files });
    } catch {
      // A failed listing just means no completions; the user can still type the
      // path by hand, so swallow it rather than surfacing an error.
      this.post({ type: HostMessageType.WorkspaceFiles, files: [] });
    }
  }

  /** Serves a file's symbols for the composer's `@path::method` completions. */
  private async sendFileSymbols(path: string): Promise<void> {
    try {
      const services = await this.ensureServices();
      const symbols = await services.promptAttachmentService.listSymbols(path);
      this.post({ type: HostMessageType.FileSymbols, path, symbols });
    } catch {
      this.post({ type: HostMessageType.FileSymbols, path, symbols: [] });
    }
  }

  public dispose(): void {
    this.abortController?.abort();
    this.pendingApprovals.clear();
    this.pendingInputs.clear();
    // Kill any MCP server processes this session spawned.
    this.services?.disposeMcp();
    this.services = undefined;
  }

  /** Builds (once) and returns the runtime services for this session. */
  private async ensureServices(): Promise<RuntimeServices> {
    if (!this.services) {
      this.services = await createRuntimeServices({
        workspaceRoot: this.workspaceRoot,
        // MCP servers connect in the background; when they're ready, refresh the
        // tool catalog and clear the spinner without rebuilding the runtime.
        onMcpToolsLoaded: (manageableTools) => {
          this.mcpLoading = false;
          this.manageableTools = manageableTools.map((tool) => ({
            name: tool.name,
            label: tool.label,
            category: tool.category,
            summary: tool.summary,
          }));
          this.services?.setDisabledTools(this.disabledTools);
          this.post({
            type: HostMessageType.McpStatus,
            loading: false,
            manageableTools: this.manageableTools,
            disabledTools: this.disabledTools,
          });
        },
      });
    }
    return this.services;
  }

  /** Loads the session and pushes a full state snapshot to the webview. */
  private async sendReady(): Promise<void> {
    // Load persisted settings so the webview always starts in sync.
    const configDir = cacheDirectory();
    const globalConfig = await readGlobalConfig(configDir);
    this.autoApprove = globalConfig.autoApprove ?? false;
    this.expandTools = globalConfig.expandTools ?? false;
    this.maxReadLines =
      globalConfig.cache?.maxReadLines ?? DEFAULT_MAX_READ_LINES;
    this.maxHistoryMessages =
      globalConfig.cache?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
    this.thinkingCollapsed = globalConfig.thinkingCollapsed ?? false;
    this.localModelAutoRefresh = globalConfig.localModelAutoRefresh ?? true;
    this.lazyToolLoading = globalConfig.lazyToolLoading ?? true;
    this.disabledTools = globalConfig.disabledTools ?? [];
    // Resolve chat modes (built-in + custom) and the active one.
    const customModes = globalConfig.customModes ?? {};
    this.agentPrompt = globalConfig.systemPrompt;
    this.customModesConfig = customModes;
    this.modes = listModes(customModes);
    this.activeModeId = isKnownMode(globalConfig.mode ?? '', customModes)
      ? (globalConfig.mode as string)
      : BUILD_MODE_ID;
    // The config stores the same string values under @core's ReasoningEffort
    // enum type; the webview protocol re-declares them as string literals.
    this.reasoningEffortByModel = (globalConfig.reasoningEffortByModel ??
      {}) as Record<
      string,
      Record<string, WebviewReasoningChoice | undefined> | undefined
    >;

    // Seed the in-memory view cache from disk so a resumed session keeps its
    // captured diffs. After a reload the cache is empty and the diff can't be
    // recomputed (the file is already edited), so without this the changes panel
    // and tool cards would come back blank. Live captures win over the restored
    // ones, so only fill ids we don't already hold.
    const persistedViews = await readToolViews(configDir, this.sessionId);
    for (const [callId, view] of persistedViews) {
      if (!this.toolViewsByCallId.has(callId)) {
        this.toolViewsByCallId.set(callId, view);
      }
    }

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
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        reasoningEffortByModel: this.reasoningEffortByModel,
        resolvedFiles: {},
      });
      return;
    }

    // Apply the current read and history limits to the runtime.
    services.setMaxReadLines(this.maxReadLines);
    services.setMaxHistoryMessages(this.maxHistoryMessages);
    services.setLocalModelAutoRefresh(this.localModelAutoRefresh);
    services.setLazyToolLoading(this.lazyToolLoading);
    services.setDisabledTools(this.disabledTools);
    services.setCurrentFile(this.currentFile);
    // Apply the active mode's system prompt to the runtime for this session.
    services.setSystemPrompt(
      resolveModeSystemPrompt(this.activeModeId, {
        agentPrompt: globalConfig.systemPrompt,
        customModes,
      })
    );
    services.setEagerlyAdvertisedTools(eagerToolsForMode(this.activeModeId));
    // Snapshot the catalog (name/label/category/description) for the popup; live
    // on/off state is tracked separately in `disabledTools`.
    this.manageableTools = services.manageableTools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      category: tool.category,
      summary: tool.summary,
    }));
    // Reflect whether MCP is still connecting so the snapshot shows the spinner;
    // the onMcpToolsLoaded callback clears it and re-sends the catalog.
    this.mcpLoading = services.mcpLoading;

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
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        reasoningEffortByModel: this.reasoningEffortByModel,
        resolvedFiles: {},
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

      // Restore the changes-panel resolutions saved for this session so resuming
      // a chat doesn't resurface edits the user already kept/undid.
      const resolvedFiles = await readResolvedFiles(configDir, this.sessionId);

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
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        reasoningEffortByModel: this.reasoningEffortByModel,
        resolvedFiles,
        ...(session.conversation.title !== undefined
          ? { sessionTitle: session.conversation.title }
          : {}),
      });

      void this.refreshAllModels(services, session.availableModels);
    } catch (error) {
      // The active provider couldn't list its models — typically a local server
      // (Ollama/LM Studio) that isn't running. Don't dead-end the panel: load
      // the conversation that's already on disk, render it, and let the model
      // picker surface the error and the other providers' models so the user can
      // switch. The background refresh re-posts the authoritative provider list.
      const conversation = await services.chatSessionService
        .loadConversation(this.sessionId)
        .catch(() => createConversation(this.sessionId));
      this.conversation = conversation;
      this.models = [];

      const providerErrors: WebviewProviderError[] = services.providerId
        ? [
            {
              providerId: services.providerId,
              providerName:
                PROVIDER_BY_ID[services.providerId]?.name ??
                services.providerId,
              message: errorMessage(error),
            },
          ]
        : [];
      this.providerErrors = providerErrors;

      const resolvedFiles = await readResolvedFiles(configDir, this.sessionId);

      this.post({
        type: HostMessageType.Ready,
        providerId: services.providerId,
        activeModel: this.activeModel,
        models: [],
        messages: await toWebviewMessages(
          conversation,
          services,
          this.toolViewsByCallId
        ),
        notice:
          'Some providers could not be reached. Open the model picker to see details and switch models.',
        providerErrors,
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        reasoningEffortByModel: this.reasoningEffortByModel,
        resolvedFiles,
        ...(conversation.title !== undefined
          ? { sessionTitle: conversation.title }
          : {}),
      });

      // Populate the picker from every reachable provider so the user can pick a
      // working model even though the active one's provider is down.
      void this.refreshAllModels(services, []);
    }
  }

  /**
   * Manually re-fetches every provider's model list: clears the on-disk cache so
   * the daily-cached entries are skipped, then re-lists. Backs the refresh button
   * in the model picker. Seeds with no existing models so a removed model
   * actually disappears from the refreshed list.
   */
  private async refreshModels(): Promise<void> {
    const services = this.services;
    if (!services) return;
    await clearModelsCache();
    await this.refreshAllModels(services, []);
  }

  /**
   * Opens the current session's persisted conversation file (its `chat.json`) in
   * an editor tab. The file lives in the cache dir, outside the workspace, so it
   * bypasses {@link openFile}'s workspace bounds check and goes straight to the
   * injected opener.
   */
  private async viewChatLog(): Promise<void> {
    const services = await this.ensureServices();
    const path = sessionFilePath(services.sessionsDirectory, this.sessionId);
    if (!existsSync(path)) {
      this.post({
        type: HostMessageType.Error,
        message: 'No chat log yet — send a message first.',
      });
      return;
    }
    this.onOpenFile?.(path);
  }

  /**
   * Lists every configured provider's models in the background and pushes the
   * merged result to the webview. The active provider's models (already shown by
   * `sendReady`) seed the list so the dropdown is never missing the live session.
   * Providers that fail (e.g. an unreachable local server) don't drop the list —
   * their error is collected into `providerErrors` so the picker can show it.
   */
  private async refreshAllModels(
    services: RuntimeServices,
    activeModels: ModelInfo[]
  ): Promise<void> {
    const providers = services.allProviders;
    const perProvider = await Promise.allSettled(
      providers.map((p) => p.listModels())
    );
    // Dedup on provider + id, not id alone: the same model id (e.g.
    // "gpt-5.4-mini") is offered by multiple providers (openai, copilot, ...)
    // and each is a distinct, separately selectable entry.
    const key = (m: ModelInfo): string => `${m.providerId}:${m.id}`;
    const seen = new Set<string>();
    const merged: ModelInfo[] = [];
    const providerErrors: WebviewProviderError[] = [];
    providers.forEach((provider, index) => {
      const result = perProvider[index];
      if (!result) return;
      if (result.status === 'fulfilled') {
        for (const m of result.value) {
          if (seen.has(key(m))) continue;
          seen.add(key(m));
          merged.push(m);
        }
      } else {
        providerErrors.push(toProviderError(provider, result.reason));
      }
    });
    for (const m of activeModels) {
      if (!seen.has(key(m))) {
        seen.add(key(m));
        merged.push(m);
      }
    }

    this.models = merged;
    this.providerErrors = providerErrors;
    this.post({
      type: HostMessageType.ModelsUpdate,
      models: merged.map(toWebviewModel),
      providerErrors,
    });
  }

  /**
   * Folds the follow-ups the user queued while this turn is running into the
   * model's next step so they steer the answer instead of waiting for the turn
   * to finish. Called by the agent loop at each step; returns the combined text
   * (or null when nothing is queued). Tells the webview which pills were consumed
   * so they disappear and the message shows in the transcript right away.
   */
  private drainSteering(): string | null {
    const queued = this.steeringQueue;
    if (queued.length === 0) return null;
    const ids = queued.map((m) => m.id);
    const content = queued
      .map((m) => m.content)
      .filter((c) => c.trim().length > 0)
      .join('\n\n');
    this.steeringQueue = [];
    if (!content.trim()) return null;
    this.post({ type: HostMessageType.SteeringConsumed, ids, content });
    return content;
  }

  /** Runs one agent turn, streaming tokens, tool activity, and approvals. */
  private async submit(
    content: string,
    images?: WebviewImage[]
  ): Promise<void> {
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

    // A fresh turn starts with an empty steering queue; follow-ups the user adds
    // while this turn runs are mirrored in via `SyncSteeringQueue`.
    this.steeringQueue = [];

    // Timing for the TTFT / tok-s footer. `firstTokenMs` is stamped by the first
    // streamed token (visible or thinking), matching the CLI's measurement.
    const startMs = Date.now();
    let firstTokenMs: number | null = null;
    const markFirstToken = (): void => {
      if (firstTokenMs === null) firstTokenMs = Date.now();
    };

    // Accumulate the streamed answer/thinking so an interrupted turn can keep the
    // partial response. The service only returns (and persists) `working` on
    // success — on abort it throws mid-loop, so without this the user's prompt
    // and the model's partial answer are lost from the next turn and the saved
    // session. Mirrors the CLI, which appends the captured partial in memory.
    let streamedContent = '';
    let streamedThinking = '';
    let thinkingStartMs = 0;

    try {
      const reasoningEffort = this.effectiveEffortForActiveModel();
      // Resolve any `@file` / `@path::method` mentions into file-content
      // attachments before the turn, so the model sees the referenced code
      // (matches the CLI). Failures here shouldn't sink the turn.
      let attachments: MessageAttachment[] | undefined = undefined;
      try {
        attachments = await services.promptAttachmentService.resolveAttachments(
          content,
          abortController.signal
        );
      } catch {
        attachments = undefined;
      }
      const result = await services.chatSessionService.submitMessage({
        conversation: this.conversation,
        model: this.activeModel,
        content,
        ...(attachments?.length ? { attachments } : {}),
        ...(images?.length
          ? {
              images: images.map((image) => ({
                mediaType: image.mediaType,
                data: image.data,
              })),
            }
          : {}),
        // The webview-flavored choice carries the same string values as @core's
        // ReasoningEffortChoice; bridge the nominal enum/literal mismatch here.
        ...(reasoningEffort
          ? { reasoningEffort: reasoningEffort as ReasoningEffortChoice }
          : {}),
        signal: abortController.signal,
        drainSteering: () => this.drainSteering(),
        onToken: (token) => {
          markFirstToken();
          streamedContent += token;
          this.post({ type: HostMessageType.Token, token });
        },
        onThinkingToken: (token) => {
          markFirstToken();
          if (thinkingStartMs === 0) thinkingStartMs = Date.now();
          streamedThinking += token;
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
        ...(!this.autoApprove && {
          requestApproval: (request) => this.requestApproval(request),
        }),
        requestUserInput: (request) => this.requestUserInput(request),
        onTitle: (_sessionId, title) => {
          // Fold the generated title into the in-memory conversation so the next
          // turn's save preserves it. Without this, the following submit writes
          // this title-less conversation back over the persisted file, and the
          // title is lost when the chat is reopened.
          if (this.conversation) {
            this.conversation = { ...this.conversation, title };
          }
          this.post({ type: HostMessageType.TitleUpdate, title });
        },
      });

      const endMs = Date.now();
      // The title is async metadata delivered via onTitle, so a turn result can
      // come back title-less even after one was generated. Keep the title we
      // already have rather than letting the fresh result drop it (mirrors the
      // CLI), so the next save persists it.
      this.conversation =
        result.conversation.title || !this.conversation?.title
          ? result.conversation
          : { ...result.conversation, title: this.conversation.title };

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
      if (aborted && this.conversation) {
        // The service threw mid-turn without returning `working`, so fold the
        // user prompt and whatever the model streamed before the interrupt into
        // the conversation, then push the rebuilt transcript to the webview as a
        // committed turn. Without this the partial lives only in the webview's
        // transient `liveTurnItems`, which the next submit clears — so the
        // interrupted answer would vanish the moment a new message is sent.
        const userMessage = createMessage(
          'user',
          content,
          new Date(),
          undefined,
          images?.length
            ? {
                images: images.map((image) => ({
                  mediaType: image.mediaType,
                  data: image.data,
                })),
              }
            : undefined
        );
        const trimmedThinking = streamedThinking.trim();
        const partialAssistant =
          streamedContent.trim() || trimmedThinking
            ? createMessage(
                'assistant',
                streamedContent,
                new Date(),
                undefined,
                {
                  ...(trimmedThinking
                    ? {
                        thinking: {
                          content: streamedThinking,
                          durationMs:
                            thinkingStartMs > 0
                              ? Date.now() - thinkingStartMs
                              : 0,
                        },
                      }
                    : {}),
                }
              )
            : undefined;
        this.conversation = {
          ...this.conversation,
          messages: [
            ...this.conversation.messages,
            userMessage,
            ...(partialAssistant ? [partialAssistant] : []),
          ],
          updatedAt: new Date().toISOString(),
        };
        // Persist now so the interrupted exchange survives a reload even if no
        // further turn is taken (a later turn would otherwise be the first save).
        await services.chatSessionService.saveConversation(this.conversation);
        this.post({
          type: HostMessageType.TurnComplete,
          messages: await toWebviewMessages(
            this.conversation,
            services,
            this.toolViewsByCallId
          ),
          ...(this.cumulativeUsage.inputTokens > 0 ||
          this.cumulativeUsage.outputTokens > 0
            ? { usage: { ...this.cumulativeUsage } }
            : {}),
        });
      }
      this.post({
        type: HostMessageType.Error,
        message: aborted ? 'Request cancelled.' : errorMessage(error),
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

    const isError = event.phase === 'end' && (event.result?.isError ?? false);
    // A rejected/failed call never touched disk, so its diff is only a preview.
    // Flag it so the post-turn rebuild (and thus the changes panel) can tell it
    // apart from an applied edit.
    if (isError) view.isError = true;

    // Capture the live view (the start phase carries the pre-edit diff) so the
    // post-turn transcript rebuild can reuse it instead of recomputing against
    // the already-edited file, which would drop the diff entirely. A bash
    // deletion diff is only known on `end`, so let that overwrite the cached
    // start view.
    const cached = this.toolViewsByCallId.get(event.toolCallId);
    if (
      event.phase === 'start' ||
      !cached ||
      (event.phase === 'end' && view.diff)
    ) {
      this.toolViewsByCallId.set(event.toolCallId, view);
    } else if (isError && cached) {
      // Keep the start view's diff (the card still shows what was attempted) but
      // record that it errored so the changes panel excludes it.
      this.toolViewsByCallId.set(event.toolCallId, {
        ...cached,
        isError: true,
      });
    }
    // Persist views that carry a diff so the changes panel and tool cards keep
    // their diffs across a webview/host reload — the pre-edit text can't be
    // recomputed once the file has changed on disk.
    if (this.toolViewsByCallId.get(event.toolCallId)?.diff) {
      void writeToolViews(
        cacheDirectory(),
        this.sessionId,
        this.toolViewsByCallId
      );
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
    // Auto-approve may have been flipped on mid-turn (e.g. the user clicked
    // "Approve all tools" on an earlier prompt). The callback is wired for the
    // whole turn, so re-check here to skip prompting for the remaining tools.
    if (this.autoApprove) return Promise.resolve(true);
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

      // Rebuilding the sessions list is the one moment we hold the authoritative
      // set of live sessions, so use it to garbage-collect sidecar entries for
      // sessions that no longer exist. Without this the resolved-files/tool-views
      // stores only shrink on explicit deletion and otherwise grow unbounded.
      const liveSessionIds = summaries.map((s) => s.sessionId);
      const cacheDir = cacheDirectory();
      void pruneResolvedFiles(cacheDir, liveSessionIds);
      void pruneToolViews(cacheDir, liveSessionIds);

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

    // Fast path: switching sessions doesn't change the provider or its model
    // list, so skip the `startSession` model fetch that `sendReady` runs — a
    // live network call for local providers (Ollama/LM Studio), a disk
    // read+parse otherwise — which is the lag the user sees when clicking a
    // session. Reuse the cached model state and just load the picked
    // conversation from disk.
    if (
      this.services?.providerId &&
      this.activeModel &&
      this.models.length > 0
    ) {
      try {
        const configDir = cacheDirectory();
        const persistedViews = await readToolViews(configDir, sessionId);
        for (const [callId, view] of persistedViews) {
          if (!this.toolViewsByCallId.has(callId)) {
            this.toolViewsByCallId.set(callId, view);
          }
        }
        const conversation =
          await this.services.chatSessionService.loadConversation(sessionId);
        this.conversation = conversation;
        const resolvedFiles = await readResolvedFiles(configDir, sessionId);
        this.post({
          type: HostMessageType.Ready,
          providerId: this.services.providerId,
          activeModel: this.activeModel,
          models: this.models.map(toWebviewModel),
          messages: await toWebviewMessages(
            conversation,
            this.services,
            this.toolViewsByCallId
          ),
          autoApprove: this.autoApprove,
          expandTools: this.expandTools,
          maxReadLines: this.maxReadLines,
          maxHistoryMessages: this.maxHistoryMessages,
          thinkingCollapsed: this.thinkingCollapsed,
          localModelAutoRefresh: this.localModelAutoRefresh,
          lazyToolLoading: this.lazyToolLoading,
          manageableTools: this.manageableTools,
          disabledTools: this.disabledTools,
          mcpLoading: this.mcpLoading,
          modes: this.modes,
          activeModeId: this.activeModeId,
          reasoningEffortByModel: this.reasoningEffortByModel,
          resolvedFiles,
          ...(conversation.title !== undefined
            ? { sessionTitle: conversation.title }
            : {}),
        });
        return;
      } catch {
        // Any failure (e.g. the conversation couldn't be read) falls through to
        // the full path so the session still opens.
        this.conversation = undefined;
      }
    }

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
    await deleteResolvedFiles(cacheDirectory(), sessionId);
    await deleteToolViews(cacheDirectory(), sessionId);

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
    await Promise.allSettled(
      summaries.map((s) => deleteResolvedFiles(cacheDirectory(), s.sessionId))
    );
    await Promise.allSettled(
      summaries.map((s) => deleteToolViews(cacheDirectory(), s.sessionId))
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
      reasoningEffortByModel: this.reasoningEffortByModel as NonNullable<
        GlobalConfig['reasoningEffortByModel']
      >,
    });
  }

  private async toggleAutoApprove(): Promise<void> {
    this.autoApprove = !this.autoApprove;
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      autoApprove: this.autoApprove,
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

  private async toggleLazyToolLoading(): Promise<void> {
    this.lazyToolLoading = !this.lazyToolLoading;
    // Apply to the live runtime so it takes effect on the next turn without a
    // reload — the chat session reads the flag per request through its getter.
    this.services?.setLazyToolLoading(this.lazyToolLoading);
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      lazyToolLoading: this.lazyToolLoading,
    });
  }

  private async setDisabledTools(names: string[]): Promise<void> {
    this.disabledTools = names;
    // Apply to the live runtime so it takes effect on the next turn without a
    // reload — the chat session reads the set per request through its getter.
    this.services?.setDisabledTools(names);
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      disabledTools: names,
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

  private async toggleLocalModelAutoRefresh(): Promise<void> {
    this.localModelAutoRefresh = !this.localModelAutoRefresh;
    // Apply to the live runtime so the change takes effect on the next model
    // listing without a reload, then refresh the panel's model list to reflect
    // it right away (a refetch when turning on, the cached list when off).
    this.services?.setLocalModelAutoRefresh(this.localModelAutoRefresh);
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      localModelAutoRefresh: this.localModelAutoRefresh,
    });
    if (this.services) {
      void this.refreshAllModels(this.services, this.models);
    }
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
   * Points `@currentfile` at the file open in the editor. Called by the view
   * provider as the active editor changes; applied to the live runtime so the
   * next completion/attachment uses it without waiting for a session reload.
   */
  public setCurrentFile(workspaceRelativePath: string | undefined): void {
    this.currentFile = workspaceRelativePath;
    this.services?.setCurrentFile(workspaceRelativePath);
  }

  /**
   * Drops cached services so the next chat interaction reloads providers from
   * config. Called by the view provider after the Settings tab connects or
   * disconnects a provider, so the live sidebar reflects the change. If the
   * removed provider backed the open session, refresh the view immediately.
   */
  public async refreshProviders(): Promise<void> {
    const previousProvider = this.services?.providerId;
    // Rebuilding services re-spawns MCP servers; tear the old ones down first.
    this.services?.disposeMcp();
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

  /**
   * Reloads MCP servers after the user edits `mcp.json` (from the Settings tab),
   * so newly added tools appear without a manual reload. Rebuilds the runtime —
   * which reconnects every server and recomputes the tool catalog — then pushes a
   * fresh snapshot to the chat view. Returns each server's load outcome so the
   * Settings page can report what connected and what failed.
   */
  public async reloadMcp(): Promise<McpServerLoadInfo[]> {
    const services = await this.ensureServices();
    // Reconnect MCP *in place* — without rebuilding the runtime or re-sending a
    // full Ready snapshot, which would reset the webview's transcript and stats.
    // Show the spinner, reconnect, then push just the refreshed tool catalog.
    this.mcpLoading = true;
    this.post({
      type: HostMessageType.McpStatus,
      loading: true,
      manageableTools: this.manageableTools,
      disabledTools: this.disabledTools,
    });

    const summary = await services.reloadMcp();

    this.manageableTools = services.manageableTools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      category: tool.category,
      summary: tool.summary,
    }));
    services.setDisabledTools(this.disabledTools);
    this.mcpLoading = false;
    this.post({
      type: HostMessageType.McpStatus,
      loading: false,
      manageableTools: this.manageableTools,
      disabledTools: this.disabledTools,
    });
    return summary;
  }

  /**
   * Switches the active chat mode: applies its system prompt to the live runtime
   * (so the next turn uses it), persists the choice, and pushes a ModeUpdate so
   * the picker reflects it — without resetting the transcript or stats.
   */
  private async selectMode(modeId: string): Promise<void> {
    if (!isKnownMode(modeId, this.customModesConfig)) return;

    // Apply the prompt synchronously from cached config so it's in force before
    // any message queued right after this one is handled — e.g. the Submit that
    // follows "Start implementation" must run under the Build prompt, not Plan.
    this.applyMode(modeId);

    // Persist the choice out of band; it doesn't gate the switch above.
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, { ...config, mode: modeId });
  }

  /**
   * Applies a mode to the live runtime — system prompt, eager tools, active id —
   * and pushes a ModeUpdate. Synchronous on purpose (no awaits) so an immediately
   * following turn sees the new prompt; persistence is handled by the caller.
   */
  private applyMode(modeId: string): void {
    this.activeModeId = modeId;
    this.services?.setSystemPrompt(
      resolveModeSystemPrompt(modeId, {
        agentPrompt: this.agentPrompt,
        customModes: this.customModesConfig,
      })
    );
    this.services?.setEagerlyAdvertisedTools(eagerToolsForMode(modeId));
    this.post({
      type: HostMessageType.ModeUpdate,
      modes: this.modes,
      activeModeId: this.activeModeId,
    });
  }

  /**
   * Creates a custom mode (name + optional system prompt), persists it, and
   * makes it active. The id is derived from the name (deduped), so the picker
   * and config stay readable.
   */
  private async createMode(name: string, systemPrompt?: string): Promise<void> {
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    const created = addCustomMode(name, systemPrompt, config.customModes ?? {});
    if (!created) return;
    const { id, customModes } = created;

    this.customModesConfig = customModes;
    this.modes = listModes(customModes);
    this.applyMode(id);
    await writeGlobalConfig(configDir, {
      ...config,
      customModes,
      mode: id,
    });
  }

  /**
   * Writes the plan to a fresh markdown file in the workspace root (a name that
   * won't clobber an existing plan), opens it for editing, and switches to Build
   * mode — so the user can refine the plan and then send it back to implement.
   */
  private async editPlan(content: string): Promise<void> {
    const fileName = this.uniquePlanFileName();
    const target = resolve(this.workspaceRoot, fileName);
    try {
      await writeFile(target, content, 'utf8');
    } catch (error) {
      this.post({
        type: HostMessageType.Error,
        message: `Couldn't create the plan file: ${errorMessage(error)}`,
      });
      return;
    }
    this.onOpenFile?.(target);
    await this.selectMode(BUILD_MODE_ID);
    this.post({
      type: HostMessageType.Notice,
      notice: `Saved the plan to ${fileName} and switched to Build mode. Edit it, then send the plan here to start implementation.`,
    });
  }

  /** A `plan.md` name in the workspace root that doesn't overwrite an existing file. */
  private uniquePlanFileName(): string {
    if (!existsSync(resolve(this.workspaceRoot, 'plan.md'))) return 'plan.md';
    let n = 2;
    while (existsSync(resolve(this.workspaceRoot, `plan-${n}.md`))) n += 1;
    return `plan-${n}.md`;
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
    if (
      this.services?.providerId &&
      this.activeModel &&
      this.models.length > 0
    ) {
      this.conversation = createConversation(this.sessionId);
      this.post({
        type: HostMessageType.Ready,
        providerId: this.services.providerId,
        activeModel: this.activeModel,
        models: this.models.map(toWebviewModel),
        messages: [],
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        reasoningEffortByModel: this.reasoningEffortByModel,
        resolvedFiles: {},
      });
      return;
    }

    this.conversation = undefined;
    await this.sendReady();
  }
}

/**
 * A tool result whose content marks it as not-applied: the user rejected it, or
 * it threw. Matches the sentinels `ChatSessionService` writes. Used on resume,
 * when the live error flag wasn't captured, so the changes panel still excludes
 * a rejected/failed edit's preview diff.
 */
function isErrorToolResultContent(content: string): boolean {
  return (
    content === 'The user rejected this tool call.' ||
    content.startsWith('Tool failed:')
  );
}

/** Flags a rebuilt tool view as errored when its result content says so. */
function markToolViewError(
  view: WebviewToolView,
  resultContent: string
): WebviewToolView {
  if (view.isError || !isErrorToolResultContent(resultContent)) return view;
  return { ...view, isError: true };
}

function toProviderError(
  provider: ProviderClient,
  reason: unknown
): WebviewProviderError {
  const entry = PROVIDER_BY_ID[provider.providerId];
  return {
    providerId: provider.providerId,
    providerName: entry?.name ?? provider.providerId,
    message: errorMessage(reason),
  };
}

/** Derives a stable, readable, unique id for a custom mode from its name. */
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
  // A mandatory model always reasons, so a stale "off" (no longer offered by the
  // picker) can't disable it — fall back to the default effort instead.
  if (stored && !(reasoning.mandatory && stored === 'off')) return stored;
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
      ...(message.role === 'tool' &&
      message.toolCallId &&
      toolViewsByCallId.has(message.toolCallId)
        ? {
            toolView: markToolViewError(
              toolViewsByCallId.get(message.toolCallId)!,
              message.content
            ),
          }
        : {}),
      ...(message.thinking ? { thinking: message.thinking } : {}),
      ...(message.role === 'user' && message.images?.length
        ? {
            images: message.images.map((image) => ({
              mediaType: image.mediaType,
              data: image.data,
            })),
          }
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
