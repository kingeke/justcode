import { PromptAttachmentService } from '@core/application/prompt-attachment-service';
import { ChatSessionService } from '@core/application/chat-session-service';
import { DEFAULT_MAX_HISTORY_MESSAGES } from '@core/application/history-window';
import { ListModelsService } from '@core/application/list-models-service';
import { ToolRegistry } from '@core/application/tool-registry';
import {
  TOOL_DISPLAY,
  type ManageableToolInfo,
  type ToolDisplay,
} from '@core/domain/tool-metadata';
import { type ProviderClient } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import { WriteFileTool } from '@runtime/tools/write-file-tool';
import { EditFileTool } from '@runtime/tools/edit-file-tool';
import { ApplyPatchTool } from '@runtime/tools/apply-patch-tool';
import { TodoWriteTool } from '@runtime/tools/todo-write-tool';
import { BashTool } from '@runtime/tools/bash-tool';
import { GrepTool } from '@runtime/tools/grep-tool';
import { GlobTool } from '@runtime/tools/glob-tool';
import { WebFetchTool } from '@runtime/tools/web-fetch-tool';
import { WebSearchTool } from '@runtime/tools/web-search-tool';
import { QuestionTool } from '@runtime/tools/question-tool';
import { ViewHistoryTool } from '@runtime/tools/view-history-tool';
import { PresentPlanTool } from '@runtime/tools/present-plan-tool';
import {
  ReadFileTool,
  DEFAULT_MAX_READ_LINES,
} from '@runtime/tools/read-file-tool';
import {
  LazyLoadToolsTool,
  type LazyLoadableToolDefinition,
} from '@runtime/tools/lazy-load-tools-tool';
import {
  loadMcpTools,
  type McpServerLoadInfo,
} from '@runtime/mcp/load-mcp-tools';
import { readMcpConfig } from '@runtime/mcp/mcp-config';
import { MCP_TOOL_PREFIX } from '@runtime/mcp/mcp-tool';
import { ProviderRegistry } from '@runtime/bootstrap/provider-registry';
import { NullProvider } from '@runtime/bootstrap/null-provider';
import { loadAppConfig } from '@runtime/config/app-config';
import { FileConversationRepository } from '@runtime/persistence/file-conversation-repository';
import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import type { AppConfig } from '@runtime/config/app-config';

export interface RuntimeServices {
  /** Active provider, or undefined when nothing has been connected yet. */
  providerId: ProviderId | undefined;
  /** Directory holding persisted session files, for locating a chat's `chat.json`. */
  sessionsDirectory: string;
  /** Workspace root the tools resolve paths against. */
  workspaceRoot: string;
  chatSessionService: ChatSessionService;
  listModelsService: ListModelsService;
  promptAttachmentService: PromptAttachmentService;
  toolRegistry: ToolRegistry;
  allProviders: ProviderClient[];
  createProvider: (id: ProviderId) => ProviderClient;
  /** Update, at runtime, how many lines a single file read returns. */
  setMaxReadLines: (lines: number) => void;
  /** Update, at runtime, how many recent messages are sent to the model. */
  setMaxHistoryMessages: (count: number) => void;
  /** Whether local providers refetch their model list on every load. */
  localModelAutoRefresh: boolean;
  /**
   * Toggle, at runtime, whether local providers refetch every load. Takes effect
   * on the providers already created (they read the flag per `listModels` call).
   */
  setLocalModelAutoRefresh: (enabled: boolean) => void;
  /** Whether lazy tool loading is on (off = send all tools up front). */
  lazyToolLoading: boolean;
  /**
   * Toggle, at runtime, lazy tool loading. Takes effect on the next turn — the
   * chat session reads the flag per request through its getter.
   */
  setLazyToolLoading: (enabled: boolean) => void;
  /**
   * The tools the user may turn on or off, in display order, each carrying its
   * current enabled state. Built from the live registry so the UI and the model
   * always agree on what exists.
   */
  manageableTools: ManageableToolInfo[];
  /**
   * Replace the set of disabled tool names. Takes effect on the next turn — the
   * chat session reads the names per request through its getter.
   */
  setDisabledTools: (names: string[]) => void;
  /**
   * Set the workspace-relative path of the file open in the host's editor (or
   * undefined when none), which the `@currentfile` mention resolves to. Read per
   * completion/attachment request, so updates take effect immediately.
   */
  setCurrentFile: (path: string | undefined) => void;
  /**
   * Replace the system prompt sent to the model, used when the user switches
   * chat mode. Read per turn, so it takes effect on the next message without a
   * reload. The host resolves the active mode's prompt (see `resolveModeSystemPrompt`).
   */
  setSystemPrompt: (prompt: string) => void;
  /**
   * Replace the tool names advertised up front even under lazy loading. The host
   * sets this per chat mode (e.g. `['present_plan']` in Plan mode, `[]` in
   * others) so a mode-specific tool is callable from the first turn. Read per
   * turn, so it takes effect on the next message.
   */
  setEagerlyAdvertisedTools: (names: string[]) => void;
  /**
   * Tears down every MCP server process spawned at startup. Hosts should call
   * this on shutdown so spawned servers don't linger. No-op when no MCP servers
   * are configured.
   */
  disposeMcp: () => void;
  /**
   * Whether MCP servers are still connecting in the background at the moment this
   * was returned. The host uses it to show a "loading MCP servers" spinner; it
   * clears once `mcpReady` resolves (and `onMcpToolsLoaded` fires).
   */
  mcpLoading: boolean;
  /**
   * Resolves once the background MCP load finishes, with each server's outcome
   * (connected? how many tools?). Resolves immediately with `[]` when no servers
   * are configured. Lets a host await the result when it needs the summary (e.g.
   * after the user saves `mcp.json`).
   */
  mcpReady: Promise<McpServerLoadInfo[]>;
  /**
   * Reconnects MCP servers in place after the user edits `mcp.json`: the old
   * server processes are killed, their tools dropped from the live registry and
   * catalog, and the new config's servers connected and folded in. Resolves with
   * each server's outcome. Crucially it does NOT rebuild the runtime, so the
   * active chat session — and the host's transcript/stats — are untouched.
   * `manageableTools` is mutated in place; re-read it after this resolves.
   */
  reloadMcp: () => Promise<McpServerLoadInfo[]>;
}

export interface CreateRuntimeOptions {
  providerId?: ProviderId;
  configDirectory?: string;
  /** If false, do not fall back to config.defaultProvider when no provider is set. */
  allowDefaultProvider?: boolean;
  /** Initial per-read line cap; falls back to the default when unset. */
  maxReadLines?: number;
  /** Initial cap on recent messages sent to the model; default when unset. */
  maxHistoryMessages?: number;
  /**
   * Root the workspace tools resolve paths against. The CLI uses the process's
   * working directory; hosts that aren't anchored to a cwd (e.g. the VSCode
   * extension) pass the active workspace folder instead.
   */
  workspaceRoot?: string;
  /**
   * Called once MCP servers finish connecting in the background, with the full
   * tool catalog (built-ins + MCP). Lets a host refresh its manage-tools UI and
   * drop the "loading MCP servers" spinner without rebuilding the runtime.
   */
  onMcpToolsLoaded?: (manageableTools: ManageableToolInfo[]) => void;
}

export async function createRuntimeServices(
  options: CreateRuntimeOptions = {}
): Promise<RuntimeServices> {
  const config = await loadAppConfig(options.configDirectory);
  const providerId =
    options.providerId ??
    (options.allowDefaultProvider === false
      ? undefined
      : config.defaultProvider);
  // Mutable so a runtime toggle reaches the providers built below: each client
  // reads `localRefresh.enabled` per `listModels` call through the getter.
  const localRefresh = { enabled: config.localModelAutoRefresh };
  const registry = new ProviderRegistry(config, () => localRefresh.enabled);
  // Without a configured provider the session is backed by a placeholder; the
  // CLI shows the connect screen and swaps in a real provider once chosen.
  const provider = providerId
    ? registry.create(providerId)
    : new NullProvider();
  const repository = new FileConversationRepository(config.sessionsDirectory);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const workspaceFiles = new LocalWorkspaceFileService(workspaceRoot);
  // Mutable so the host (the VSCode extension) can update which file
  // `@currentfile` points at as the user switches editor tabs; read per
  // completion/attachment request. The CLI never sets it, so `@currentfile`
  // simply isn't offered there.
  const currentFile: { path: string | undefined } = { path: undefined };
  const readSettings = {
    maxReadLines: options.maxReadLines ?? DEFAULT_MAX_READ_LINES,
  };
  const historySettings = {
    maxHistoryMessages:
      options.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES,
  };
  // Mutable so a runtime toggle reaches the chat session: the service reads
  // `lazyToolLoadingSettings.enabled` per turn through the getter below.
  const lazyToolLoadingSettings = { enabled: config.lazyToolLoading };
  // Mutable so a runtime toggle reaches the chat session, which reads the set
  // per turn through `getDisabledToolNames` below.
  const disabledToolsSettings = { names: config.disabledTools };
  // Mutable so switching chat mode (which swaps the prompt) reaches the chat
  // session: it reads `systemPromptSetting.value` per turn. The host resolves
  // the active mode's prompt and calls `setSystemPrompt`; until then it's the
  // configured base (the Build/agent prompt).
  const systemPromptSetting = { value: config.systemPrompt };
  // Tool names to advertise up front even under lazy loading (the host sets this
  // per mode — e.g. `present_plan` in Plan mode — so a mode-specific tool is
  // reachable from the first turn without loading the whole toolset).
  const eagerToolsSetting = { names: [] as string[] };
  const builtInTools = [
    new WriteFileTool(workspaceFiles),
    new EditFileTool(workspaceFiles),
    new ApplyPatchTool(workspaceFiles),
    new ReadFileTool(workspaceFiles, () => readSettings.maxReadLines),
    new GrepTool(workspaceFiles),
    new GlobTool(workspaceFiles),
    new BashTool(),
    new TodoWriteTool(),
    new WebFetchTool(),
    new WebSearchTool(),
    new QuestionTool(),
    new ViewHistoryTool(),
    new PresentPlanTool(),
  ];
  const lazyLoadableTools: LazyLoadableToolDefinition[] = builtInTools.map(
    (tool) => ({
      ...tool.definition,
      requiresApproval: tool.requiresApproval,
    })
  );
  // The user-facing catalog: every toggleable tool in display order — built-ins
  // first, then one group per MCP server (appended later, when MCP finishes
  // connecting) — joined to its live description and seeded with its on/off state
  // from the saved config.
  const definitionsByName = new Map(
    builtInTools.map((tool) => [tool.definition.name, tool.definition])
  );
  const initialDisabled = new Set(disabledToolsSettings.names);
  const toManageable = (display: ToolDisplay): ManageableToolInfo[] => {
    const definition = definitionsByName.get(display.name);
    if (!definition) return [];
    return [
      {
        ...display,
        description: definition.description,
        enabled: !initialDisabled.has(display.name),
      },
    ];
  };
  // Mutated in place when MCP tools arrive, so callers holding this reference (and
  // the host re-reading it from the load callback) see the MCP entries appear.
  const manageableTools: ManageableToolInfo[] =
    TOOL_DISPLAY.flatMap(toManageable);
  const lazyLoadToolsTool = new LazyLoadToolsTool(lazyLoadableTools);
  const toolRegistry = new ToolRegistry(
    [lazyLoadToolsTool, ...builtInTools],
    [
      {
        ...lazyLoadToolsTool.definition,
        requiresApproval: lazyLoadToolsTool.requiresApproval,
      },
    ]
  );

  // Holds the teardown for whatever MCP clients are currently connected, swapped
  // each (re)load so the previous batch's processes are always killed first.
  let disposeMcpClients: () => void = () => {};

  // Reads `mcp.json`, connects its servers, and folds their tools into the live
  // registry and catalog (both mutated in place so existing references — the
  // chat session's registry, the host's manageableTools — pick the tools up).
  // Shared by the initial background load and by `reloadMcp`.
  const loadAndRegisterMcp = async (): Promise<McpServerLoadInfo[]> => {
    const mcp = await loadMcpTools(config.configDirectory);
    disposeMcpClients = mcp.dispose;
    toolRegistry.add(mcp.tools);
    for (const tool of mcp.tools) {
      definitionsByName.set(tool.definition.name, tool.definition);
    }
    for (const display of mcp.displays) {
      manageableTools.push(...toManageable(display));
    }
    return mcp.servers;
  };

  // Drops the previously loaded MCP tools from the registry and catalog so a
  // reload reflects removals (and never duplicates a still-present server).
  const clearMcp = (): void => {
    disposeMcpClients();
    disposeMcpClients = () => {};
    toolRegistry.removeWhere((name) => name.startsWith(MCP_TOOL_PREFIX));
    for (const name of [...definitionsByName.keys()]) {
      if (name.startsWith(MCP_TOOL_PREFIX)) definitionsByName.delete(name);
    }
    for (let i = manageableTools.length - 1; i >= 0; i -= 1) {
      if (manageableTools[i]?.name.startsWith(MCP_TOOL_PREFIX)) {
        manageableTools.splice(i, 1);
      }
    }
  };

  // Connect MCP servers in the background so a slow server (e.g. a cold `npx`
  // launch) never blocks startup, the session list, or the first message. Their
  // tools are folded into the live registry and catalog when they're ready, and
  // `onMcpToolsLoaded` lets the host refresh its UI (and drop the spinner). A
  // broken or missing config yields nothing and never throws — MCP is additive.
  const configuredServers = await readMcpConfig(config.configDirectory);
  const hasServers = Object.values(configuredServers).some(
    (server) => server.disabled !== true
  );
  // Live loading flag (not a snapshot): a host reads it through the `mcpLoading`
  // getter below, so a `sendReady` that fires *after* the load already finished
  // sees `false` and doesn't re-raise the spinner that nothing would clear.
  const mcpState = { loading: hasServers };
  const mcpReady: Promise<McpServerLoadInfo[]> = !hasServers
    ? Promise.resolve([])
    : loadAndRegisterMcp()
        .then((servers) => {
          mcpState.loading = false;
          options.onMcpToolsLoaded?.([...manageableTools]);
          return servers;
        })
        .catch(() => {
          mcpState.loading = false;
          return [];
        });
  const allProviders = createAllProviders(config, registry);

  return {
    providerId,
    sessionsDirectory: config.sessionsDirectory,
    workspaceRoot,
    chatSessionService: new ChatSessionService(repository, provider, {
      toolRegistry,
      workspaceRoot,
      workspaceFiles,
      getSystemPrompt: () => systemPromptSetting.value,
      getMaxHistoryMessages: () => historySettings.maxHistoryMessages,
      getLazyToolLoadingEnabled: () => lazyToolLoadingSettings.enabled,
      getDisabledToolNames: () => disabledToolsSettings.names,
      getEagerlyAdvertisedToolNames: () => eagerToolsSetting.names,
    }),
    listModelsService: new ListModelsService(provider),
    promptAttachmentService: new PromptAttachmentService(
      workspaceFiles,
      () => readSettings.maxReadLines,
      () => currentFile.path
    ),
    toolRegistry,
    allProviders,
    createProvider: (id: ProviderId) => registry.create(id),
    setMaxReadLines: (lines: number) => {
      readSettings.maxReadLines = lines;
    },
    setMaxHistoryMessages: (count: number) => {
      historySettings.maxHistoryMessages = count;
    },
    localModelAutoRefresh: localRefresh.enabled,
    setLocalModelAutoRefresh: (enabled: boolean) => {
      localRefresh.enabled = enabled;
    },
    lazyToolLoading: lazyToolLoadingSettings.enabled,
    setLazyToolLoading: (enabled: boolean) => {
      lazyToolLoadingSettings.enabled = enabled;
    },
    manageableTools,
    setDisabledTools: (names: string[]) => {
      disabledToolsSettings.names = names;
    },
    setCurrentFile: (path: string | undefined) => {
      currentFile.path = path;
    },
    setSystemPrompt: (prompt: string) => {
      systemPromptSetting.value = prompt;
    },
    setEagerlyAdvertisedTools: (names: string[]) => {
      eagerToolsSetting.names = names;
    },
    disposeMcp: () => disposeMcpClients(),
    get mcpLoading() {
      return mcpState.loading;
    },
    mcpReady,
    reloadMcp: async () => {
      mcpState.loading = true;
      clearMcp();
      try {
        return await loadAndRegisterMcp();
      } finally {
        mcpState.loading = false;
      }
    },
  };
}

function createAllProviders(
  config: AppConfig,
  registry: ProviderRegistry
): ProviderClient[] {
  return config.configuredProviders.flatMap((id) => {
    try {
      return [registry.create(id)];
    } catch {
      return [];
    }
  });
}
