import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  createConversation,
  type Conversation,
  type SessionStats,
} from '@core/domain/conversation';
import { APP_NAME } from '@core/branding';
import {
  createMessage,
  MessageRole,
  type ChatMessage,
  type MessageAttachment,
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
  getInterruptedConversation,
  type ToolApprovalRequest,
  ToolActivityPhase,
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
  DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT,
  DEFAULT_COMPACT_PROMPT,
} from '@core/application/compact-prompt';
import {
  SUB_AGENT_CONFIGS,
  SubAgentType,
  type SubAgentRun,
} from '@core/domain/sub-agent';
import {
  readGlobalConfig,
  writeGlobalConfig,
  type GlobalConfig,
} from '@runtime/persistence/global-config';
import {
  createRuntimeServices,
  type RuntimeServices,
} from '@runtime/bootstrap/create-services';
import {
  sessionFilePath,
  sessionMessagesFilePath,
} from '@runtime/persistence/file-conversation-repository';
import type { McpServerLoadInfo } from '@runtime/mcp/load-mcp-tools';
import { discoverAllSkills } from '@runtime/skills/skill-store';
import {
  buildSkillCommandIndex,
  renderSkillCommandPrompt,
  type SkillCommandIndex,
} from '@core/domain/skill';
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
  SettingsSection,
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
  type WebviewSkillCommand,
  type TokenMessage,
  type ThinkingMessage,
  type ToolActivityMessage,
  type SubAgentActivityMessage,
  type WebviewSubAgentRunSnapshot,
  WebviewSubAgentPhase,
  WebviewSubAgentStatus,
} from '@ext/shared/protocol';
import {
  addCustomMode,
  removeCustomMode,
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
  // The installed skills' slash commands, discovered per snapshot in sendReady.
  // The index resolves a typed `/name` to its command host-side; the flattened
  // list rides every Ready message to drive the composer's `/` completions.
  private skillCommands: SkillCommandIndex | undefined;
  private webviewSkillCommands: WebviewSkillCommand[] = [];
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
  // Session id of the turn currently in flight, if any. Lets the sessions list
  // flag that session as loading and a reopened session restore its busy state,
  // since a turn keeps running in the host after the user navigates away.
  private activeTurnSessionId: string | undefined;
  // The in-flight turn's output as an ordered, coalesced stream of the webview
  // messages that produced it (token/thinking runs + tool activity). Reopening
  // the session mid-turn replays these through the same reducer, rebuilding the
  // live thinking, tool cards, and streaming answer exactly — with their
  // original ordering, which the host otherwise can't reconstruct. Reset per turn.
  private liveTurnEvents: Array<
    | TokenMessage
    | ThinkingMessage
    | ToolActivityMessage
    | SubAgentActivityMessage
  > = [];
  // Live sub agent runs of the in-flight turn, keyed by run id. Each value is
  // the run object the task tool mutates as the sub agent works, so serving a
  // transcript request reads the freshest messages. Reset per turn; finished
  // turns' runs live on `conversation.subAgentRuns` instead.
  private liveSubAgentRuns = new Map<string, SubAgentRun>();
  // Epoch ms of the in-flight turn's start and first token, sent on resume so
  // the webview's live tok/s keeps its original time base. Undefined off-turn.
  private turnStartedAtMs: number | undefined;
  private turnFirstTokenAtMs: number | undefined;
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
  // Auto-compact when the last request used at least this percent of the
  // model's context window; 0 turns it off. Checked after each completed turn.
  private autoCompactThresholdPercent = DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT;
  // Guards re-entry: a compaction is a model call of its own, so a second
  // trigger while one runs (or while a turn runs) must be ignored.
  private compacting = false;
  // The last "auto-compact is close" milestone warned (5/3/2/1 points left),
  // so each milestone posts one notice instead of re-warning every turn.
  // Reset when the pressure drops (compaction, metrics reset).
  private autoCompactWarnedMilestone: number | null = null;
  private thinkingCollapsed = false;
  // When true (default), local providers refetch their model list every load;
  // when false they use the once-a-day cache. Applied to the live runtime via
  // `setLocalModelAutoRefresh` so toggling takes effect without a reload.
  private localModelAutoRefresh = true;
  // When true (default), cached model lists auto-refresh once a day; when false
  // they're served indefinitely and only "Refresh models" refetches. Applied to
  // the live runtime via `setModelAutoRefresh`.
  private modelAutoRefresh = true;
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
  private askPrompt: string | undefined;
  private planPrompt: string | undefined;
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
  // footer (ctx / in / cached / out / cost). Reset whenever the conversation is.
  private cumulativeUsage: Required<Omit<WebviewUsage, 'lastInputTokens'>> = {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    cost: 0,
  };
  // Whether the accumulated cost reflects real pricing. Stays false while the
  // active model has no pricing and the provider reports no cost, so the footer
  // hides the readout instead of showing a misleading $0.0000.
  private costKnown = false;
  // The session tok/s average, maintained incrementally per completed turn:
  // avg += (sample − avg) / count. Equal weight per turn, no re-averaging.
  private avgTokensPerSecond = 0;
  private completedTurnCount = 0;
  // Input tokens of the most recent request, persisted with the session stats
  // (the CLI derives its ctx(%) readout from it).
  private lastInputTokens = 0;
  // TTFT / tok/s of the most recent completed turn, kept so a Ready snapshot
  // can restore the footer's timing readouts after a session switch or reload.
  private lastTurnStats:
    | { ttftMs: number; tokensPerSecond: number }
    | undefined;

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
    private readonly onOpenSettings?: (section?: SettingsSection) => void,
    /** Opens a workspace file in the editor; injected by the view provider. */
    private readonly onOpenFile?: (absolutePath: string) => void,
    /**
     * Opens VSCode's native diff editor for a changed file: `baseline`
     * (pre-session content) against the current on-disk file. Injected by the
     * view provider.
     */
    private readonly onOpenDiff?: (
      absolutePath: string,
      relativePath: string,
      baseline: string,
      created: boolean
    ) => void
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
      case WebviewMessageType.Retry:
        await this.retry(
          message.messageId,
          message.content !== undefined
            ? { content: message.content, images: message.images }
            : undefined
        );
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
        this.onOpenSettings?.(message.section);
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
        if (this.refuseNavigationWhileCompacting()) return;
        await this.resetSession();
        return;
      case WebviewMessageType.ListSessions:
        // Data-only refreshes are always fine; leaving the chat view is not
        // while a compaction runs (its progress/result would land on whatever
        // session the user wandered into).
        if ((message.focus ?? true) && this.refuseNavigationWhileCompacting())
          return;
        await this.sendSessionsList(message.focus ?? true);
        return;
      case WebviewMessageType.OpenSession:
        if (this.refuseNavigationWhileCompacting()) return;
        await this.openSession(message.sessionId);
        return;
      case WebviewMessageType.RenameSession:
        await this.renameSession(message.sessionId, message.title);
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
      case WebviewMessageType.CompactSession:
        await this.compactSession();
        return;
      case WebviewMessageType.SetAutoCompactThreshold:
        await this.setAutoCompactThreshold(message.percent);
        return;
      case WebviewMessageType.ToggleThinkingCollapsed:
        await this.toggleThinkingCollapsed();
        return;
      case WebviewMessageType.ToggleLocalModelAutoRefresh:
        await this.toggleLocalModelAutoRefresh();
        return;
      case WebviewMessageType.ToggleModelAutoRefresh:
        await this.toggleModelAutoRefresh();
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
      case WebviewMessageType.DeleteMode:
        await this.deleteMode(message.modeId);
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
      case WebviewMessageType.OpenDiff:
        this.openDiff(message.path, message.baseline, message.created);
        return;
      case WebviewMessageType.OpenMcpConfig:
        // Open the Settings tab's MCP section, where the user edits mcp.json in a
        // textarea and saves — which reconnects servers live (see reloadMcp).
        this.onOpenSettings?.(SettingsSection.Mcp);
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
      case WebviewMessageType.RequestSubAgentTranscript:
        await this.sendSubAgentTranscript(message.runId);
        return;
      case WebviewMessageType.RequestFileSymbols:
        await this.sendFileSymbols(message.path);
        return;
    }
  }

  /**
   * Serves a sub agent run's full transcript for the webview's popup viewer.
   * Prefers the live run (its messages grow while the sub agent works, and the
   * webview re-requests on each activity event) and falls back to the runs
   * persisted on the conversation for finished turns.
   */
  private async sendSubAgentTranscript(runId: string): Promise<void> {
    const run =
      this.liveSubAgentRuns.get(runId) ??
      this.conversation?.subAgentRuns?.find((entry) => entry.id === runId);
    if (!run) return;
    try {
      const services = await this.ensureServices();
      // Wrap the run's messages in a throwaway conversation so the same
      // converter (tool views, thinking, role mapping) renders them.
      const messages = await toWebviewMessages(
        {
          sessionId: runId,
          messages: run.messages,
          createdAt: run.startedAt,
          updatedAt: run.endedAt ?? run.startedAt,
        },
        services
      );
      this.post({
        type: HostMessageType.SubAgentTranscript,
        runId,
        messages,
      });
    } catch {
      // A failed conversion just leaves the popup empty; nothing to surface.
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

  /**
   * Discovers installed skills — the workspace's `.justcode/skills` plus the
   * global scope, local shadowing global — and rebuilds the slash-command
   * index. Fail-soft: any error just means no skill commands this session.
   * Re-run per snapshot so skills installed via the CLI appear after a reload
   * without restarting.
   */
  private async loadSkillCommands(): Promise<void> {
    try {
      const { skills } = await discoverAllSkills({
        configDirectory: cacheDirectory(),
        workspaceRoot: this.workspaceRoot,
      });
      this.skillCommands = buildSkillCommandIndex(skills);
      this.webviewSkillCommands = this.skillCommands.commands.map((ref) => ({
        name: ref.bareName ?? ref.qualifiedName,
        skillName: ref.skillName,
        description: ref.command.description,
        argumentHint: ref.command.argumentHint,
      }));
    } catch {
      this.skillCommands = undefined;
      this.webviewSkillCommands = [];
    }
  }

  /**
   * Re-discovers installed skills (after a Settings-tab add/update/remove) and
   * pushes the fresh command list so the composer's `/` completions update
   * without reloading the panel.
   */
  public async refreshSkillCommands(): Promise<void> {
    await this.loadSkillCommands();
    this.post({
      type: HostMessageType.SkillCommandsUpdate,
      skillCommands: this.webviewSkillCommands,
    });
  }

  /**
   * When the submitted text invokes a skill command (`/name args…`), the
   * per-turn overrides that run it: the command's markdown body as the system
   * prompt, its frontmatter tools advertised eagerly, and its model when the
   * active provider lists it. Text that doesn't resolve is just a message.
   */
  private resolveSkillTurn(content: string):
    | {
        systemPrompt: string;
        tools?: string[];
        model?: string;
      }
    | undefined {
    if (!content.startsWith('/') || !this.skillCommands) return undefined;
    const invocation = content.slice(1);
    const spaceIndex = invocation.search(/\s/);
    const name =
      spaceIndex === -1 ? invocation : invocation.slice(0, spaceIndex);
    const args = spaceIndex === -1 ? '' : invocation.slice(spaceIndex + 1);
    const ref = this.skillCommands.resolve(name);
    if (!ref) return undefined;
    const overrides: {
      systemPrompt: string;
      tools?: string[];
      model?: string;
    } = {
      systemPrompt: renderSkillCommandPrompt(ref.command, args),
    };
    if (ref.command.tools?.length) overrides.tools = ref.command.tools;
    const wantedModel = ref.command.model;
    if (
      wantedModel &&
      wantedModel !== 'auto' &&
      this.models.some((model) => model.id === wantedModel)
    ) {
      overrides.model = wantedModel;
    }
    return overrides;
  }

  /** Loads the session and pushes a full state snapshot to the webview. */
  private async sendReady(): Promise<void> {
    // Load persisted settings so the webview always starts in sync.
    const configDir = cacheDirectory();
    // Refresh the skill slash commands with each snapshot (cheap local reads).
    await this.loadSkillCommands();
    const globalConfig = await readGlobalConfig(configDir);
    this.autoApprove = globalConfig.autoApprove ?? false;
    this.expandTools = globalConfig.expandTools ?? false;
    this.maxReadLines =
      globalConfig.cache?.maxReadLines ?? DEFAULT_MAX_READ_LINES;
    this.maxHistoryMessages =
      globalConfig.cache?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES;
    this.autoCompactThresholdPercent =
      globalConfig.autoCompactThresholdPercent ??
      DEFAULT_AUTO_COMPACT_THRESHOLD_PERCENT;
    this.thinkingCollapsed = globalConfig.thinkingCollapsed ?? false;
    this.localModelAutoRefresh = globalConfig.localModelAutoRefresh ?? true;
    this.modelAutoRefresh = globalConfig.modelAutoRefresh ?? true;
    this.lazyToolLoading = globalConfig.lazyToolLoading ?? true;
    this.disabledTools = globalConfig.disabledTools ?? [];
    // Resolve chat modes (built-in + custom) and the active one.
    const customModes = globalConfig.customModes ?? {};
    this.agentPrompt = globalConfig.systemPrompt;
    this.askPrompt = globalConfig.askSystemPrompt;
    this.planPrompt = globalConfig.planSystemPrompt;
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
        sessionId: this.sessionId,
        providerId: undefined,
        activeModel: undefined,
        models: [],
        messages: [],
        notice: `Failed to start ${APP_NAME}: ${errorMessage(error)}`,
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        autoCompactThresholdPercent: this.autoCompactThresholdPercent,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        modelAutoRefresh: this.modelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        skillCommands: this.webviewSkillCommands,
        reasoningEffortByModel: this.reasoningEffortByModel,
        workspaceRoot: this.workspaceRoot,
        resolvedFiles: {},
      });
      return;
    }

    // Apply the current read and history limits to the runtime.
    services.setMaxReadLines(this.maxReadLines);
    services.setMaxHistoryMessages(this.maxHistoryMessages);
    services.setLocalModelAutoRefresh(this.localModelAutoRefresh);
    services.setModelAutoRefresh(this.modelAutoRefresh);
    services.setLazyToolLoading(this.lazyToolLoading);
    services.setDisabledTools(this.disabledTools);
    services.setCurrentFile(this.currentFile);
    // Apply the active mode's system prompt to the runtime for this session.
    services.setSystemPrompt(
      resolveModeSystemPrompt(this.activeModeId, {
        agentPrompt: globalConfig.systemPrompt,
        askPrompt: globalConfig.askSystemPrompt,
        planPrompt: globalConfig.planSystemPrompt,
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
        sessionId: this.sessionId,
        providerId: undefined,
        activeModel: undefined,
        models: [],
        messages: [],
        notice: `No provider is configured. Connect one with the ${APP_NAME} CLI (or set the provider env vars), then reload this view.`,
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        autoCompactThresholdPercent: this.autoCompactThresholdPercent,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        modelAutoRefresh: this.modelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        skillCommands: this.webviewSkillCommands,
        reasoningEffortByModel: this.reasoningEffortByModel,
        workspaceRoot: this.workspaceRoot,
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
      this.restoreStats(session.conversation);
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
        sessionId: this.sessionId,
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
        autoCompactThresholdPercent: this.autoCompactThresholdPercent,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        modelAutoRefresh: this.modelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        skillCommands: this.webviewSkillCommands,
        reasoningEffortByModel: this.reasoningEffortByModel,
        workspaceRoot: this.workspaceRoot,
        resolvedFiles,
        subAgents: toSubAgentSnapshots(session.conversation),
        ...(session.conversation.title !== undefined
          ? { sessionTitle: session.conversation.title }
          : {}),
        ...this.statsSnapshot(),
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
      this.restoreStats(conversation);
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
        sessionId: this.sessionId,
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
        autoCompactThresholdPercent: this.autoCompactThresholdPercent,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        modelAutoRefresh: this.modelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        skillCommands: this.webviewSkillCommands,
        reasoningEffortByModel: this.reasoningEffortByModel,
        workspaceRoot: this.workspaceRoot,
        resolvedFiles,
        subAgents: toSubAgentSnapshots(conversation),
        ...(conversation.title !== undefined
          ? { sessionTitle: conversation.title }
          : {}),
        ...this.statsSnapshot(),
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
    // The full history lives in the messages file; older sessions still hold it
    // in the summary file, so fall back to that before giving up.
    const messagesPath = sessionMessagesFilePath(
      services.sessionsDirectory,
      this.sessionId
    );
    const summaryPath = sessionFilePath(
      services.sessionsDirectory,
      this.sessionId
    );
    const path = existsSync(messagesPath)
      ? messagesPath
      : existsSync(summaryPath)
        ? summaryPath
        : undefined;
    if (!path) {
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

  /**
   * Re-sends a previous user message: drops that message and everything after
   * it from the conversation, persists the truncation, and submits the same
   * content (and images) as a fresh turn — or, when `edit` is given, the
   * edited replacement instead of the original. Only messages in the current
   * epoch can be retried — compacted-away history is no longer real context.
   */
  private async retry(
    messageId: string,
    edit?: { content: string; images?: WebviewImage[] | undefined }
  ): Promise<void> {
    if (this.abortController || this.compacting) {
      this.post({
        type: HostMessageType.Error,
        message: this.compacting
          ? 'Compaction is in progress — try again when it finishes.'
          : 'A turn is already in progress.',
      });
      return;
    }
    const services = await this.ensureServices();
    const conversation = this.conversation;
    if (!conversation) {
      this.post({
        type: HostMessageType.Error,
        message: 'No active session. Configure a provider and reload.',
      });
      return;
    }
    const index = conversation.messages.findIndex(
      (m) => m.id === messageId && m.role === MessageRole.User
    );
    if (index === -1) {
      this.post({
        type: HostMessageType.Error,
        message: 'Only messages in the current context can be retried.',
      });
      return;
    }
    const target = conversation.messages[index]!;
    // Drop the retried message too — the submit below appends a fresh copy.
    this.conversation = {
      ...conversation,
      messages: conversation.messages.slice(0, index),
      updatedAt: new Date().toISOString(),
    };
    // Persist the truncation now, so a retry whose turn fails before the
    // service's own save doesn't resurrect the scrapped tail on reload.
    await services.chatSessionService.saveConversation(this.conversation);
    await this.submit(
      edit ? edit.content : target.content,
      edit
        ? edit.images
        : target.images?.map((image, i) => ({
            id: `retry-${i}`,
            mediaType: image.mediaType,
            data: image.data,
          }))
    );
    // A turn that produced anything (success, or an abort whose partial was
    // adopted) grew the conversation past the truncation point. If it's still
    // at that point, the turn failed hard (e.g. a provider timeout) before the
    // re-submitted copy was persisted — put the original message back so it
    // matches what the webview still shows and stays retryable.
    if (
      this.conversation &&
      this.conversation.sessionId === conversation.sessionId &&
      this.conversation.messages.length <= index
    ) {
      this.conversation = {
        ...this.conversation,
        messages: [...this.conversation.messages, target],
        updatedAt: new Date().toISOString(),
      };
      await services.chatSessionService.saveConversation(this.conversation);
    }
  }

  /** Runs one agent turn, streaming tokens, tool activity, and approvals. */
  private async submit(
    content: string,
    images?: WebviewImage[]
  ): Promise<void> {
    // `/usage` is a host command, not a turn: show the provider-reported plan
    // usage (Claude Code) as a transient notice instead of running the model.
    // Handled before the turn-in-progress guard so it works even while a turn is
    // running — it neither starts nor steers the turn.
    if (content.trim() === '/usage') {
      await this.showProviderUsage(await this.ensureServices());
      return;
    }

    if (this.abortController || this.compacting) {
      this.post({
        type: HostMessageType.Error,
        message: this.compacting
          ? 'Compaction is in progress — try again when it finishes.'
          : 'A turn is already in progress.',
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
    this.activeTurnSessionId = this.conversation.sessionId;
    this.liveTurnEvents = [];
    this.liveSubAgentRuns.clear();

    // A fresh turn starts with an empty steering queue; follow-ups the user adds
    // while this turn runs are mirrored in via `SyncSteeringQueue`.
    this.steeringQueue = [];

    // Timing for the TTFT / tok-s footer. `firstTokenMs` is stamped by the first
    // streamed token (visible or thinking), matching the CLI's measurement.
    const startMs = Date.now();
    this.turnStartedAtMs = startMs;
    this.turnFirstTokenAtMs = undefined;
    let firstTokenMs: number | null = null;
    const markFirstToken = (): void => {
      if (firstTokenMs === null) {
        firstTokenMs = Date.now();
        this.turnFirstTokenAtMs = firstTokenMs;
      }
    };

    // Accumulate the streamed answer/thinking so an interrupted turn can keep the
    // partial response. The service only returns (and persists) `working` on
    // success — on abort it throws mid-loop, so without this the user's prompt
    // and the model's partial answer are lost from the next turn and the saved
    // session. Mirrors the CLI, which appends the captured partial in memory.
    let streamedContent = '';
    let streamedThinking = '';
    let thinkingStartMs = 0;
    // Set on turn success so the auto-compact check after the finally (it must
    // run once the abort controller is released) knows the turn completed.
    let turnSucceeded = false;

    try {
      const reasoningEffort = this.effectiveEffortForActiveModel();
      // A leading `/skill-command` runs with the command's markdown body as
      // this turn's system prompt (plus its frontmatter tools/model). Text that
      // doesn't resolve to an installed command is just a normal message.
      const skillTurn = this.resolveSkillTurn(content);
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
        model: skillTurn?.model ?? this.activeModel,
        content,
        ...(skillTurn ? { systemPromptOverride: skillTurn.systemPrompt } : {}),
        ...(skillTurn?.tools ? { eagerToolNames: skillTurn.tools } : {}),
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
        ...(this.models.find((m) => m.id === this.activeModel)?.reasoning
          ?.mandatory
          ? { reasoningMandatory: true }
          : {}),
        signal: abortController.signal,
        drainSteering: () => this.drainSteering(),
        onToken: (token) => {
          markFirstToken();
          streamedContent += token;
          this.recordLiveTurnToken(token);
          this.post({ type: HostMessageType.Token, token });
        },
        onThinkingToken: (token) => {
          markFirstToken();
          if (thinkingStartMs === 0) thinkingStartMs = Date.now();
          streamedThinking += token;
          this.recordLiveTurnThinking(token);
          this.post({ type: HostMessageType.Thinking, token });
        },
        onUsage: (stepUsage) => {
          // Accumulate each response's usage as it arrives and push a live
          // snapshot, so the footer metrics track the turn in progress.
          this.accumulateUsage(stepUsage);
          this.post({
            type: HostMessageType.UsageUpdate,
            usage: this.usageSnapshot(),
          });
        },
        onSubAgentActivity: (event) => {
          // Keep the live run object so transcript requests can read its
          // messages while the sub agent is still working.
          if (event.run) this.liveSubAgentRuns.set(event.runId, event.run);
          const message: SubAgentActivityMessage = {
            type: HostMessageType.SubAgentActivity,
            phase: event.phase as string as WebviewSubAgentPhase,
            runId: event.runId,
            agentType: event.agentType,
            description: event.description,
            ...(event.latestActivity
              ? { latestActivity: event.latestActivity }
              : {}),
            ...(event.toolUseCount !== undefined
              ? { toolUseCount: event.toolUseCount }
              : {}),
            ...(event.status
              ? { status: event.status as string as WebviewSubAgentStatus }
              : {}),
            ...(event.summary !== undefined ? { summary: event.summary } : {}),
          };
          this.liveTurnEvents.push(message);
          this.post(message);
        },
        onToolActivity: (event) => {
          // A tool call is the model's first output for turns that act before
          // they speak (no streamed prose/thinking — common on the Claude Code
          // provider). Mark first-token here too, so TTFT settles instead of
          // climbing for the whole turn and tok/s isn't divided by a
          // milliseconds-long window (mirrors the CLI).
          if (event.phase === ToolActivityPhase.Start) markFirstToken();
          this.postToolActivity(event);
        },
        // Auto-approve runs approval-gated tools without prompting. Express that
        // as an explicit `allowUnattended` opt-in — the engine fails closed when
        // neither an approver nor this flag is present, so simply omitting
        // requestApproval would (correctly) reject every gated tool.
        ...(this.autoApprove
          ? { allowUnattended: true }
          : { requestApproval: (request) => this.requestApproval(request) }),
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
        this.completedTurnCount += 1;
        this.avgTokensPerSecond +=
          (tokensPerSecond - this.avgTokensPerSecond) / this.completedTurnCount;
        this.lastTurnStats = { ttftMs, tokensPerSecond };
        stats = {
          ttftMs,
          tokensPerSecond,
          avgTokensPerSecond: this.avgTokensPerSecond,
        };
      }

      // Persist the footer metrics with the conversation so a resumed session
      // restores them instead of starting from zero.
      this.persistSessionStats(services);

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
        ...(hasUsage ? { usage: this.usageSnapshot() } : {}),
        ...(stats ? { stats } : {}),
      });
      turnSucceeded = true;
    } catch (error) {
      const aborted = isAbortError(error);
      if (this.conversation) {
        // On abort, the service persisted everything the interrupted turn
        // produced — the user prompt, completed tool rounds, per-step
        // thinking, and the partial streamed answer — and attached the saved
        // conversation to the abort error. Adopt it and push the rebuilt
        // transcript to the webview as a committed turn. Without this the
        // partial lives only in the webview's transient `liveTurnItems`,
        // which the next submit clears — so the interrupted answer would
        // vanish the moment a new message is sent.
        //
        // A plain failure (e.g. a network error before the stream started)
        // persists nothing at all, so it takes the same fallback: committing
        // the prompt gives the webview a real message id in place of its
        // optimistic `local-` echo, which is what makes the retry/edit
        // actions available on the failed message.
        const interruptedConversation = aborted
          ? getInterruptedConversation(error)
          : undefined;
        if (interruptedConversation) {
          this.conversation =
            interruptedConversation.title || !this.conversation.title
              ? interruptedConversation
              : {
                  ...interruptedConversation,
                  title: this.conversation.title,
                };
        } else {
          // Plain failures land here (aborts too, if the service's persist
          // failed): rebuild the exchange from this bridge's streaming
          // buffers and save it ourselves.
          const userMessage = createMessage(
            MessageRole.User,
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
                  MessageRole.Assistant,
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
          // Persist now so the interrupted exchange survives a reload even if
          // no further turn is taken (a later turn would otherwise be the
          // first save).
          await services.chatSessionService.saveConversation(this.conversation);
        }
        // Keep whatever usage the completed steps reported before the interrupt.
        this.persistSessionStats(services);
        this.post({
          type: HostMessageType.TurnComplete,
          messages: await toWebviewMessages(
            this.conversation,
            services,
            this.toolViewsByCallId
          ),
          ...(this.cumulativeUsage.inputTokens > 0 ||
          this.cumulativeUsage.outputTokens > 0
            ? { usage: this.usageSnapshot() }
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
      this.activeTurnSessionId = undefined;
      this.liveTurnEvents = [];
      this.turnStartedAtMs = undefined;
      this.turnFirstTokenAtMs = undefined;
      // Any approval/input prompts still open belong to the turn that just
      // ended; drop them so a late webview reply can't resolve a stale promise.
      this.pendingApprovals.clear();
      this.pendingInputs.clear();
      // Refresh the sessions list (if it's showing) so the loading indicator
      // clears once the turn finishes.
      void this.sendSessionsList(false);
    }

    // Auto-compact: when this turn's request used at least the configured share
    // of the model's context window, compact now so the next message starts
    // from the summary. Only after a successful turn — never mid-turn or off an
    // interrupted one — and only when the model reports its window size. Within
    // 5 points below the threshold, warn instead (once per milestone: 5/3/2/1
    // points left), so the compaction pause never comes as a surprise.
    const contextWindow = this.models.find(
      (m) => m.id === this.activeModel
    )?.contextWindow;
    if (
      turnSucceeded &&
      this.autoCompactThresholdPercent > 0 &&
      contextWindow != null &&
      contextWindow > 0
    ) {
      const threshold = this.autoCompactThresholdPercent;
      const pct = Math.min(
        100,
        Math.round((this.lastInputTokens / contextWindow) * 100)
      );
      if (pct >= threshold) {
        await this.compactSession();
      } else {
        const milestone = autoCompactWarnMilestone(threshold - pct);
        if (
          milestone !== null &&
          (this.autoCompactWarnedMilestone === null ||
            milestone < this.autoCompactWarnedMilestone)
        ) {
          this.autoCompactWarnedMilestone = milestone;
          this.post({
            type: HostMessageType.Notice,
            notice: `Context ${pct}% full — auto-compact triggers at >=${threshold}%.`,
            timeoutMs: 5000,
          });
        }
      }
    }
  }

  /**
   * Folds one turn's usage into the running session totals, deriving cost from
   * the active model's pricing when the provider didn't report it (mirrors the
   * CLI's metrics footer).
   */
  private accumulateUsage(usage: TokenUsage): void {
    const cost = usage.cost ?? this.estimateCost(usage);
    // Cost is only meaningful when the provider reported it or we have the
    // active model's pricing to derive it. Otherwise it stays a misleading $0,
    // so track known-ness and hide the readout entirely (see usageSnapshot).
    if (usage.cost !== undefined || this.activeModelHasPricing()) {
      this.costKnown = true;
    }
    this.lastInputTokens = usage.inputTokens;
    this.cumulativeUsage = {
      inputTokens: this.cumulativeUsage.inputTokens + usage.inputTokens,
      outputTokens: this.cumulativeUsage.outputTokens + usage.outputTokens,
      cachedTokens: this.cumulativeUsage.cachedTokens + usage.cachedTokens,
      cost: this.cumulativeUsage.cost + cost,
    };
  }

  private activeModelHasPricing(): boolean {
    return !!this.models.find((m) => m.id === this.activeModel)?.pricing;
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
    this.costKnown = false;
    this.avgTokensPerSecond = 0;
    this.completedTurnCount = 0;
    this.lastInputTokens = 0;
    this.autoCompactWarnedMilestone = null;
    this.lastTurnStats = undefined;
    this.toolViewsByCallId.clear();
    this.capturedDeletions.clear();
  }

  /**
   * Restores the footer metrics persisted with a loaded conversation. Skipped
   * when live totals already exist — they include any turn since the last
   * persist, so they're always at least as fresh as what's on disk.
   */
  private restoreStats(conversation: Conversation): void {
    const stats = conversation.stats;
    if (!stats) return;
    if (
      this.cumulativeUsage.inputTokens > 0 ||
      this.cumulativeUsage.outputTokens > 0
    ) {
      return;
    }
    this.cumulativeUsage = {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cachedTokens: stats.cachedTokens,
      cost: stats.cost,
    };
    // A persisted nonzero cost means pricing was known at the time; a zero cost
    // is re-derived on the next turn, so don't surface it until then.
    this.costKnown = stats.cost > 0;
    this.lastInputTokens = stats.lastInputTokens;
    this.avgTokensPerSecond = stats.avgTokensPerSecond ?? 0;
    this.completedTurnCount = stats.completedTurnCount ?? 0;
    this.lastTurnStats =
      stats.ttftMs !== undefined && stats.tokensPerSecond !== undefined
        ? { ttftMs: stats.ttftMs, tokensPerSecond: stats.tokensPerSecond }
        : undefined;
  }

  /**
   * The usage payload posted to the webview: the session's cumulative totals
   * plus the most recent request's input tokens (the "ctx" readout).
   */
  private usageSnapshot(): WebviewUsage {
    const { cost, ...rest } = this.cumulativeUsage;
    return {
      ...rest,
      lastInputTokens: this.lastInputTokens,
      // Omit cost when pricing is unknown so the footer hides it rather than
      // showing $0.0000.
      ...(this.costKnown ? { cost } : {}),
    };
  }

  /**
   * The usage/stats fields of a Ready snapshot, present only when there's
   * something to show — a fresh session's footer starts blank.
   */
  private statsSnapshot(): { usage?: WebviewUsage; stats?: WebviewStats } {
    const hasUsage =
      this.cumulativeUsage.inputTokens > 0 ||
      this.cumulativeUsage.outputTokens > 0;
    return {
      ...(hasUsage ? { usage: this.usageSnapshot() } : {}),
      // Restore the timing readouts whenever any turn has completed, even if
      // the last turn's TTFT wasn't captured — the webview's live estimator
      // reads the average from here, so omitting it would zero the AVG mid-turn.
      ...(this.lastTurnStats || this.completedTurnCount > 0
        ? {
            stats: {
              ttftMs: this.lastTurnStats?.ttftMs ?? 0,
              tokensPerSecond: this.lastTurnStats?.tokensPerSecond ?? 0,
              avgTokensPerSecond: this.avgTokensPerSecond,
            },
          }
        : {}),
    };
  }

  /**
   * Writes the current footer metrics onto the session's persisted conversation
   * so resuming it restores them. Best-effort — the service swallows failures.
   */
  private persistSessionStats(services: RuntimeServices): void {
    const stats: SessionStats = {
      ...this.cumulativeUsage,
      lastInputTokens: this.lastInputTokens,
      ...(this.lastTurnStats ? { ...this.lastTurnStats } : {}),
      avgTokensPerSecond: this.avgTokensPerSecond,
      completedTurnCount: this.completedTurnCount,
    };
    void services.chatSessionService.saveSessionStats(this.sessionId, stats);
  }

  private postToolActivity(event: ToolActivityEvent): void {
    const view = toToolView(event.view);

    // Bash is the only path to a file deletion (there's no delete tool), and it
    // emits no diff. Capture the soon-to-be-deleted content before the command
    // runs, then synthesize a deletion diff once the file is gone so it shows in
    // the changes panel like any other edit.
    if (event.toolName === ToolName.Bash) {
      if (event.phase === ToolActivityPhase.Start) {
        this.captureDeletionCandidates(event.toolCallId, view.preview);
      } else {
        const diff = this.resolveDeletionDiff(event.toolCallId);
        if (diff) view.diff = diff;
      }
    }

    const isError =
      event.phase === ToolActivityPhase.End && (event.result?.isError ?? false);
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
      event.phase === ToolActivityPhase.Start ||
      !cached ||
      (event.phase === ToolActivityPhase.End && view.diff)
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
    const message: ToolActivityMessage = {
      type: HostMessageType.ToolActivity,
      phase:
        event.phase === ToolActivityPhase.Start
          ? ToolPhase.Start
          : ToolPhase.End,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      view,
      ...(event.result
        ? {
            isError: event.result.isError ?? false,
            resultPreview: truncate(event.result.content, RESULT_PREVIEW_LIMIT),
          }
        : {}),
    };
    this.liveTurnEvents.push(message);
    this.post(message);
  }

  // Coalesce consecutive answer/thinking tokens into a single recorded event so a
  // resume replays a handful of messages, not one per token. The reducer treats
  // a Token/Thinking message's payload as opaque text to append, so a merged run
  // rebuilds identically.
  private recordLiveTurnToken(token: string): void {
    const last = this.liveTurnEvents.at(-1);
    if (last?.type === HostMessageType.Token) {
      last.token += token;
    } else {
      this.liveTurnEvents.push({ type: HostMessageType.Token, token });
    }
  }

  private recordLiveTurnThinking(token: string): void {
    const last = this.liveTurnEvents.at(-1);
    if (last?.type === HostMessageType.Thinking) {
      last.token += token;
    } else {
      this.liveTurnEvents.push({ type: HostMessageType.Thinking, token });
    }
  }

  /**
   * Replays the in-flight turn's recorded events to the webview, in order, so a
   * freshly reopened session rebuilds the live thinking/tool/answer state through
   * the normal reducer path. Posted right after the resume `Ready` (which clears
   * the transient live state); subsequent live events append as usual.
   */
  private replayLiveTurn(): void {
    for (const event of this.liveTurnEvents) {
      this.post(event);
    }
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

  private async sendSessionsList(focus = true): Promise<void> {
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
        focus,
        ...(this.activeTurnSessionId
          ? { activeSessionId: this.activeTurnSessionId }
          : {}),
      });
    } catch (error) {
      this.post({
        type: HostMessageType.SessionsList,
        sessions: [],
        hasConnectedProvider: false,
        focus,
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
        this.restoreStats(conversation);
        const resolvedFiles = await readResolvedFiles(configDir, sessionId);
        this.post({
          type: HostMessageType.Ready,
          sessionId: this.sessionId,
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
          autoCompactThresholdPercent: this.autoCompactThresholdPercent,
          thinkingCollapsed: this.thinkingCollapsed,
          localModelAutoRefresh: this.localModelAutoRefresh,
          modelAutoRefresh: this.modelAutoRefresh,
          lazyToolLoading: this.lazyToolLoading,
          manageableTools: this.manageableTools,
          disabledTools: this.disabledTools,
          mcpLoading: this.mcpLoading,
          modes: this.modes,
          activeModeId: this.activeModeId,
          skillCommands: this.webviewSkillCommands,
          reasoningEffortByModel: this.reasoningEffortByModel,
          workspaceRoot: this.workspaceRoot,
          resolvedFiles,
          subAgents: toSubAgentSnapshots(conversation),
          ...(conversation.title !== undefined
            ? { sessionTitle: conversation.title }
            : {}),
          ...this.statsSnapshot(),
          // Reopening the session whose turn is still running: restore its busy
          // state and timing; the recorded live-turn events (replayed just below)
          // rebuild the thinking/tool/answer state.
          ...(this.activeTurnSessionId === sessionId
            ? {
                busy: true,
                ...(this.turnStartedAtMs !== undefined
                  ? { turnStartedAt: this.turnStartedAtMs }
                  : {}),
                ...(this.turnFirstTokenAtMs !== undefined
                  ? { turnFirstTokenAt: this.turnFirstTokenAtMs }
                  : {}),
              }
            : {}),
        });
        if (this.activeTurnSessionId === sessionId) this.replayLiveTurn();
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
    const wasCurrent = sessionId === this.sessionId;
    if (wasCurrent) {
      this.sessionId = randomUUID();
      this.conversation = undefined;
      this.resetMetrics();
    }

    // Deleting the open session leaves nothing to show, so navigate to the
    // sessions list; deleting any other (e.g. from the header's session
    // switcher) just refreshes the data without yanking the user out of chat.
    await this.sendSessionsList(wasCurrent);
  }

  private async renameSession(sessionId: string, title: string): Promise<void> {
    const services = await this.ensureServices();
    let updated;
    try {
      updated = await services.chatSessionService.renameSession(
        sessionId,
        title
      );
    } catch (error) {
      this.post({ type: HostMessageType.Error, message: errorMessage(error) });
      return;
    }

    // Keep the in-memory copy (and the chat header) in step when the renamed
    // session is the one currently loaded.
    if (sessionId === this.sessionId && this.conversation) {
      const next = { ...this.conversation };
      if (updated.title) next.title = updated.title;
      else delete next.title;
      this.conversation = next;
      this.post({
        type: HostMessageType.TitleUpdate,
        title: updated.title ?? '',
      });
    }

    // Refresh the list in place so the new title shows without leaving the view.
    await this.sendSessionsList(false);
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

  /** Backs the `/usage` command: plan windows + session cost as a notice. */
  private async showProviderUsage(services: RuntimeServices): Promise<void> {
    try {
      if (!services.providerId) {
        this.post({
          type: HostMessageType.Notice,
          notice: 'Connect a provider before checking usage.',
          timeoutMs: 6000,
        });
        return;
      }
      const client = services.createProvider(services.providerId);
      if (!client.getUsageSummary) {
        this.post({
          type: HostMessageType.Notice,
          notice: `The ${String(services.providerId)} provider doesn't report plan usage.`,
          timeoutMs: 6000,
        });
        return;
      }
      // Show a spinner while the provider is queried — Claude Code spawns a
      // probe, which takes a moment. The result notice below replaces it.
      this.post({
        type: HostMessageType.Notice,
        notice: 'Fetching usage…',
        loading: true,
      });
      const summary = await client.getUsageSummary(
        this.conversation?.sessionId
      );
      const parts: string[] = [];
      for (const window of summary.windows) {
        const pct =
          window.utilization != null
            ? `${Math.round(window.utilization)}%`
            : 'n/a';
        const resets = window.resetsAt
          ? ` (resets ${new Date(window.resetsAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })})`
          : '';
        parts.push(`${window.label} ${pct}${resets}`);
      }
      if (parts.length === 0) parts.push('no rate-limit windows reported');
      const plan = summary.plan ? `${summary.plan} · ` : '';
      const cost =
        summary.sessionCostUsd != null
          ? ` · session ≈$${summary.sessionCostUsd.toFixed(4)}`
          : '';
      this.post({
        type: HostMessageType.Notice,
        notice: `Usage: ${plan}${parts.join(' · ')}${cost}`,
        timeoutMs: 15000,
      });
    } catch (error) {
      this.post({
        type: HostMessageType.Notice,
        notice: `Usage lookup failed: ${errorMessage(error)}`,
        timeoutMs: 8000,
      });
    }
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

  /**
   * While a compaction runs the user stays in the compacting session — its
   * progress and result must land where they started. Returns true (and posts
   * a transient notice) when navigation should be refused.
   */
  private refuseNavigationWhileCompacting(): boolean {
    if (!this.compacting) return false;
    this.post({
      type: HostMessageType.Notice,
      notice:
        'Compaction in progress — wait for it to finish, or stop it first.',
      timeoutMs: 5000,
    });
    return true;
  }

  /** 0 turns auto-compact off; otherwise the percent of the window that triggers it. */
  private async setAutoCompactThreshold(percent: number): Promise<void> {
    this.autoCompactThresholdPercent = percent;
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      autoCompactThresholdPercent: percent,
    });
  }

  /**
   * Summarizes the conversation and swaps it for the compacted one (the old
   * messages move to `previousMessages`; the transcript keeps showing them
   * above a divider). Skipped while a turn or another compaction runs. On
   * success the refreshed transcript rides a TurnComplete; on failure the
   * conversation is untouched and the error rides the final CompactStatus.
   */
  private async compactSession(): Promise<void> {
    if (this.compacting || this.abortController) return;
    const services = await this.ensureServices();
    if (!this.conversation || !this.activeModel) return;
    const [firstMessage] = this.conversation.messages;
    if (
      this.conversation.messages.length === 0 ||
      (this.conversation.messages.length === 1 &&
        firstMessage?.isCompactSummary)
    ) {
      this.post({
        type: HostMessageType.Notice,
        notice: 'Nothing to compact yet.',
        timeoutMs: 5000,
      });
      return;
    }

    this.compacting = true;
    // Compaction takes the same abort slot as a turn, so the webview's Stop
    // button (a Cancel message) tears it down exactly like an in-flight turn.
    // Nothing is saved until the summary lands, so a cancel is always safe.
    const abortController = new AbortController();
    this.abortController = abortController;
    // If the user navigates to another session while this runs, the result
    // must not be painted onto (or adopted as) that other conversation.
    const compactingSessionId = this.conversation.sessionId;
    this.post({ type: HostMessageType.CompactStatus, running: true });
    try {
      const reasoningEffort = this.effectiveEffortForActiveModel();
      // The summary streams like any reply; push its rough size periodically
      // so the UI's indeterminate bar has a live "how much so far" label.
      let summaryChars = 0;
      let lastProgressPost = 0;
      const result = await services.chatSessionService.compactSession({
        conversation: this.conversation,
        model: this.activeModel,
        signal: abortController.signal,
        ...(reasoningEffort
          ? { reasoningEffort: reasoningEffort as ReasoningEffortChoice }
          : {}),
        onToken: (token) => {
          summaryChars += token.length;
          const now = Date.now();
          if (now - lastProgressPost < 250) return;
          lastProgressPost = now;
          const tokens = Math.max(1, Math.round(summaryChars / 4));
          this.post({
            type: HostMessageType.CompactStatus,
            running: true,
            tokens,
          });
        },
      });
      // The compacted conversation is already saved to disk; only adopt it in
      // memory (and refresh the transcript) if this session is still the one
      // showing. Reopening it later loads the compacted state from disk.
      if (this.conversation?.sessionId !== compactingSessionId) {
        this.post({ type: HostMessageType.CompactStatus, running: false });
        return;
      }
      this.conversation = result.conversation;
      // The summarization call is a real request: fold its usage into the
      // session totals, but zero the ctx readout — the next turn starts from
      // the compact summary (this also keeps auto-compact from refiring).
      if (result.usage) {
        this.accumulateUsage(result.usage);
      }
      this.lastInputTokens = 0;
      // Pressure has dropped back to zero; re-arm the approach warnings.
      this.autoCompactWarnedMilestone = null;
      this.persistSessionStats(services);
      this.post({
        type: HostMessageType.TurnComplete,
        messages: await toWebviewMessages(
          this.conversation,
          services,
          this.toolViewsByCallId
        ),
        ...(this.cumulativeUsage.inputTokens > 0 ||
        this.cumulativeUsage.outputTokens > 0
          ? { usage: this.usageSnapshot() }
          : {}),
      });
      this.post({ type: HostMessageType.CompactStatus, running: false });
    } catch (error) {
      if (isAbortError(error)) {
        // Cancelled by the user: nothing was saved, the conversation is
        // exactly as it was — no error to surface, just a gentle notice.
        this.post({ type: HostMessageType.CompactStatus, running: false });
        this.post({
          type: HostMessageType.Notice,
          notice: 'Compaction cancelled.',
          timeoutMs: 5000,
        });
      } else {
        this.post({
          type: HostMessageType.CompactStatus,
          running: false,
          error: errorMessage(error),
        });
      }
    } finally {
      this.compacting = false;
      // Only release the slot if it's still ours — never clobber a turn's.
      if (this.abortController === abortController) {
        this.abortController = undefined;
      }
    }
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

  private async toggleModelAutoRefresh(): Promise<void> {
    this.modelAutoRefresh = !this.modelAutoRefresh;
    // Apply to the live runtime so the change takes effect on the next model
    // listing without a reload.
    this.services?.setModelAutoRefresh(this.modelAutoRefresh);
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    await writeGlobalConfig(configDir, {
      ...config,
      modelAutoRefresh: this.modelAutoRefresh,
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

  /**
   * Opens VSCode's native diff editor for a changed file: the pre-session
   * `baseline` against the current on-disk file. The path is workspace-relative
   * and is resolved + bounds-checked mirroring {@link openFile}, so a malformed
   * path can't diff something outside the workspace.
   */
  private openDiff(path: string, baseline: string, created: boolean): void {
    const target = resolve(this.workspaceRoot, path);
    const rel = relative(this.workspaceRoot, target);
    if (rel.startsWith('..') || isAbsolute(rel)) return;
    this.onOpenDiff?.(target, path, created ? '' : baseline, created);
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

    // If the previously active provider is no longer configured — disconnected,
    // or wiped by a reset — drop the stale conversation and model so we don't
    // request a now-missing provider's model.
    const config = await readGlobalConfig(cacheDirectory());
    const stillConfigured =
      previousProvider !== undefined &&
      Object.keys(config.providers ?? {}).includes(previousProvider);
    if (!stillConfigured) {
      this.conversation = undefined;
      this.activeModel = undefined;
    }

    // Always re-render the live view — even with no conversation yet. Connecting
    // a first provider must surface it without a reload, and a reset must clear
    // the transcript. `sendReady` reflects the provider/model state;
    // `sendSessionsList` refreshes the session dropdown from disk (now empty
    // after a reset), so neither goes stale until the next manual reload.
    await this.sendReady();
    // Only pull the user to the sessions list when the active conversation was
    // dropped (reset/disconnect); merely adding a provider keeps them in chat.
    await this.sendSessionsList(!stillConfigured);
  }

  /**
   * Re-reads the mode system prompts from config (after an edit in the Settings
   * tab) and re-applies the active mode, so the next turn runs under the new
   * prompt — without rebuilding the runtime or resetting the transcript.
   */
  public async refreshPrompts(): Promise<void> {
    const config = await readGlobalConfig(cacheDirectory());
    this.agentPrompt = config.systemPrompt;
    this.askPrompt = config.askSystemPrompt;
    this.planPrompt = config.planSystemPrompt;
    // An edited compaction prompt applies to the next /compact immediately.
    this.services?.setCompactPrompt(
      config.compactPrompt ?? DEFAULT_COMPACT_PROMPT
    );
    // Edited sub agent prompts apply to the next spawned sub agent.
    this.services?.setSubAgentPrompt(
      SubAgentType.Explorer,
      config.explorerSubAgentPrompt ??
        SUB_AGENT_CONFIGS[SubAgentType.Explorer].systemPrompt
    );
    this.services?.setSubAgentPrompt(
      SubAgentType.General,
      config.generalSubAgentPrompt ??
        SUB_AGENT_CONFIGS[SubAgentType.General].systemPrompt
    );
    // Created/edited/deleted custom sub agents reach the task tool on its next
    // call (schema and runs alike).
    this.services?.setCustomSubAgents(config.customSubAgents ?? {});
    this.customModesConfig = config.customModes ?? {};
    this.modes = listModes(this.customModesConfig);
    if (!isKnownMode(this.activeModeId, this.customModesConfig)) {
      this.activeModeId = BUILD_MODE_ID;
    }
    this.applyMode(this.activeModeId);
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
        askPrompt: this.askPrompt,
        planPrompt: this.planPrompt,
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
   * Deletes a custom mode (built-ins are refused by `removeCustomMode`),
   * persists the removal, and — when the deleted mode was active — switches to
   * Build. `applyMode` pushes the refreshed list to the picker either way.
   */
  private async deleteMode(modeId: string): Promise<void> {
    const configDir = cacheDirectory();
    const config = await readGlobalConfig(configDir);
    const removed = removeCustomMode(modeId, config.customModes ?? {});
    if (!removed) return;

    this.customModesConfig = removed.customModes;
    this.modes = listModes(removed.customModes);
    const nextActive =
      this.activeModeId === modeId ? BUILD_MODE_ID : this.activeModeId;
    this.applyMode(nextActive);
    await writeGlobalConfig(configDir, {
      ...config,
      customModes: removed.customModes,
      ...(config.mode === modeId ? { mode: nextActive } : {}),
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
    // Clicking "+" while the current session has no messages reuses it instead
    // of minting another — repeated clicks shouldn't scatter empty sessions.
    let reuseEmptySession =
      this.conversation !== undefined &&
      this.conversation.messages.length === 0;
    if (!reuseEmptySession) {
      // Coming from a chat with messages: adopt the most recent already-empty
      // session (a leftover "New chat") before minting another, so "+" never
      // scatters empty sessions across the list.
      const emptySessionId = await this.findEmptySessionId();
      if (emptySessionId) {
        this.sessionId = emptySessionId;
        this.conversation = createConversation(emptySessionId);
        reuseEmptySession = true;
      } else {
        // Start a new session without touching the existing one — it's already
        // persisted and should remain visible in the sessions list.
        this.sessionId = randomUUID();
      }
    }
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
      if (!reuseEmptySession) {
        this.conversation = createConversation(this.sessionId);
      }
      await this.persistEmptySession();
      this.post({
        type: HostMessageType.Ready,
        sessionId: this.sessionId,
        providerId: this.services.providerId,
        activeModel: this.activeModel,
        models: this.models.map(toWebviewModel),
        messages: [],
        autoApprove: this.autoApprove,
        expandTools: this.expandTools,
        maxReadLines: this.maxReadLines,
        maxHistoryMessages: this.maxHistoryMessages,
        autoCompactThresholdPercent: this.autoCompactThresholdPercent,
        thinkingCollapsed: this.thinkingCollapsed,
        localModelAutoRefresh: this.localModelAutoRefresh,
        modelAutoRefresh: this.modelAutoRefresh,
        lazyToolLoading: this.lazyToolLoading,
        manageableTools: this.manageableTools,
        disabledTools: this.disabledTools,
        mcpLoading: this.mcpLoading,
        modes: this.modes,
        activeModeId: this.activeModeId,
        skillCommands: this.webviewSkillCommands,
        reasoningEffortByModel: this.reasoningEffortByModel,
        workspaceRoot: this.workspaceRoot,
        resolvedFiles: {},
      });
      return;
    }

    this.conversation = undefined;
    await this.sendReady();
    await this.persistEmptySession();
  }

  /**
   * The most recently updated persisted session that still has no messages, if
   * any. `listSessions` returns most-recent-first, so the first empty summary
   * is the one "+" should adopt. Best-effort: a listing failure just means a
   * fresh session gets minted instead.
   */
  private async findEmptySessionId(): Promise<string | undefined> {
    try {
      const services = await this.ensureServices();
      const summaries = await services.chatSessionService.listSessions();
      return summaries.find((summary) => summary.messageCount === 0)?.sessionId;
    } catch {
      return undefined;
    }
  }

  /**
   * Writes the current conversation to disk when it's still empty, so a new
   * session exists as a file (and in the sessions list) before the first
   * message. Best-effort: on failure the first turn's save creates it as
   * before.
   */
  private async persistEmptySession(): Promise<void> {
    const conversation = this.conversation;
    if (!conversation || conversation.messages.length > 0) return;
    try {
      const services = await this.ensureServices();
      await services.chatSessionService.saveConversation(conversation);
    } catch {
      // Non-fatal: the file will be created by the first turn's save.
    }
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

/**
 * Flags a rebuilt tool view as errored. Prefers the persisted `isError` flag on
 * the tool message; the content heuristic remains as a fallback for sessions
 * saved before the flag existed.
 */
function markToolViewError(
  view: WebviewToolView,
  message: ChatMessage
): WebviewToolView {
  if (view.isError) return view;
  if (message.isError !== true && !isErrorToolResultContent(message.content)) {
    return view;
  }
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
 * Summarizes a conversation's persisted sub agent runs for the Ready snapshot,
 * so a reopened session still lists them (robot popup) and can open each run's
 * transcript. Tool-use counts are recomputed from the stored messages.
 */
export function toSubAgentSnapshots(
  conversation: Conversation
): WebviewSubAgentRunSnapshot[] {
  return (conversation.subAgentRuns ?? []).map((run) => ({
    runId: run.id,
    agentType: run.agentType,
    description: run.description,
    status: run.status as string as WebviewSubAgentStatus,
    toolUseCount: run.messages.filter(
      (message) => message.role === MessageRole.Tool
    ).length,
    ...(run.summary !== undefined ? { summary: run.summary } : {}),
    startedAt: Date.parse(run.startedAt),
    ...(run.endedAt !== undefined ? { endedAt: Date.parse(run.endedAt) } : {}),
  }));
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
  // Compacted-away epochs render first, so the full transcript stays visible;
  // the flagged summary message that opens each new epoch draws the divider.
  for (const message of [
    ...(conversation.previousMessages ?? []),
    ...conversation.messages,
  ]) {
    if (message.role === MessageRole.System) continue;
    if (
      message.role === MessageRole.Assistant &&
      message.toolCalls?.length &&
      services
    ) {
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
      message.role === MessageRole.Assistant &&
      !message.content.trim() &&
      !message.thinking
    ) {
      continue;
    }
    result.push({
      id: message.id,
      role: toWebviewRole(message.role),
      content: message.content,
      createdAt: message.createdAt,
      ...(message.llmReceivedAt
        ? { llmReceivedAt: message.llmReceivedAt }
        : {}),
      ...(message.role === MessageRole.Tool && message.name
        ? { toolName: message.name }
        : {}),
      ...(message.role === MessageRole.Tool &&
      message.toolCallId &&
      toolViewsByCallId.has(message.toolCallId)
        ? {
            toolView: markToolViewError(
              toolViewsByCallId.get(message.toolCallId)!,
              message
            ),
          }
        : {}),
      ...(message.thinking ? { thinking: message.thinking } : {}),
      ...(message.isCompactSummary ? { isCompactSummary: true } : {}),
      ...(message.role === MessageRole.User && message.images?.length
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

/**
 * Which "auto-compact is close" milestone applies for the given distance (in
 * percentage points) below the threshold: 1, 2, or 3 points left map to that
 * milestone, up to 5 maps to 5, and anything farther is no warning. Each
 * milestone is warned once as pressure rises (mirrors the CLI).
 */
function autoCompactWarnMilestone(pointsLeft: number): number | null {
  if (pointsLeft > 5) return null;
  if (pointsLeft <= 3) return Math.max(1, Math.ceil(pointsLeft));
  return 5;
}

function toWebviewRole(role: MessageRole): WebviewRole {
  switch (role) {
    case MessageRole.User:
      return WebviewRole.User;
    case MessageRole.Assistant:
      return WebviewRole.Assistant;
    case MessageRole.Tool:
      return WebviewRole.Tool;
    case MessageRole.System:
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
