import { PromptAttachmentService } from '@core/application/prompt-attachment-service';
import { ChatSessionService } from '@core/application/chat-session-service';
import { DEFAULT_MAX_HISTORY_MESSAGES } from '@core/application/history-window';
import { ListModelsService } from '@core/application/list-models-service';
import { ToolRegistry } from '@core/application/tool-registry';
import {
  TOOL_DISPLAY,
  type ManageableToolInfo,
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
import {
  ReadFileTool,
  DEFAULT_MAX_READ_LINES,
} from '@runtime/tools/read-file-tool';
import {
  LazyLoadToolsTool,
  type LazyLoadableToolDefinition,
} from '@runtime/tools/lazy-load-tools-tool';
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
  const runtimeTools = [
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
  ];
  const lazyLoadableTools: LazyLoadableToolDefinition[] = runtimeTools.map(
    (tool) => ({
      ...tool.definition,
      requiresApproval: tool.requiresApproval,
    })
  );
  // The user-facing catalog: each toggleable tool in display order, joined to
  // its live description and seeded with its on/off state from the saved config.
  const definitionsByName = new Map(
    runtimeTools.map((tool) => [tool.definition.name, tool.definition])
  );
  const initialDisabled = new Set(disabledToolsSettings.names);
  const manageableTools: ManageableToolInfo[] = TOOL_DISPLAY.flatMap(
    (display) => {
      const definition = definitionsByName.get(display.name);
      if (!definition) return [];
      return [
        {
          ...display,
          description: definition.description,
          enabled: !initialDisabled.has(display.name),
        },
      ];
    }
  );
  const lazyLoadToolsTool = new LazyLoadToolsTool(lazyLoadableTools);
  const toolRegistry = new ToolRegistry(
    [lazyLoadToolsTool, ...runtimeTools],
    [
      {
        ...lazyLoadToolsTool.definition,
        requiresApproval: lazyLoadToolsTool.requiresApproval,
      },
    ]
  );
  const allProviders = createAllProviders(config, registry);

  return {
    providerId,
    sessionsDirectory: config.sessionsDirectory,
    workspaceRoot,
    chatSessionService: new ChatSessionService(repository, provider, {
      toolRegistry,
      workspaceRoot,
      workspaceFiles,
      systemPrompt: config.systemPrompt,
      getMaxHistoryMessages: () => historySettings.maxHistoryMessages,
      getLazyToolLoadingEnabled: () => lazyToolLoadingSettings.enabled,
      getDisabledToolNames: () => disabledToolsSettings.names,
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
