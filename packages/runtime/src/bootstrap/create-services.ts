import { PromptAttachmentService } from '@core/application/prompt-attachment-service';
import { ChatSessionService } from '@core/application/chat-session-service';
import { ListModelsService } from '@core/application/list-models-service';
import { ToolRegistry } from '@core/application/tool-registry';
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
import {
  ReadFileTool,
  DEFAULT_MAX_READ_LINES,
} from '@runtime/tools/read-file-tool';
import { ProviderRegistry } from '@runtime/bootstrap/provider-registry';
import { NullProvider } from '@runtime/bootstrap/null-provider';
import { loadAppConfig } from '@runtime/config/app-config';
import { FileConversationRepository } from '@runtime/persistence/file-conversation-repository';
import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import type { AppConfig } from '@runtime/config/app-config';

export interface RuntimeServices {
  /** Active provider, or undefined when nothing has been connected yet. */
  providerId: ProviderId | undefined;
  chatSessionService: ChatSessionService;
  listModelsService: ListModelsService;
  promptAttachmentService: PromptAttachmentService;
  allProviders: ProviderClient[];
  createProvider: (id: ProviderId) => ProviderClient;
  /** Update, at runtime, how many lines a single file read returns. */
  setMaxReadLines: (lines: number) => void;
}

export interface CreateRuntimeOptions {
  providerId?: ProviderId;
  configDirectory?: string;
  /** If false, do not fall back to config.defaultProvider when no provider is set. */
  allowDefaultProvider?: boolean;
  /** Initial per-read line cap; falls back to the default when unset. */
  maxReadLines?: number;
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
  const registry = new ProviderRegistry(config);
  // Without a configured provider the session is backed by a placeholder; the
  // CLI shows the connect screen and swaps in a real provider once chosen.
  const provider = providerId
    ? registry.create(providerId)
    : new NullProvider();
  const repository = new FileConversationRepository(config.sessionsDirectory);
  const workspaceRoot = process.cwd();
  const workspaceFiles = new LocalWorkspaceFileService(workspaceRoot);
  const readSettings = {
    maxReadLines: options.maxReadLines ?? DEFAULT_MAX_READ_LINES,
  };
  const toolRegistry = new ToolRegistry([
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
  ]);
  const allProviders = createAllProviders(config, registry);

  return {
    providerId,
    chatSessionService: new ChatSessionService(repository, provider, {
      toolRegistry,
      workspaceRoot,
      workspaceFiles,
      systemPrompt: config.systemPrompt,
    }),
    listModelsService: new ListModelsService(provider),
    promptAttachmentService: new PromptAttachmentService(
      workspaceFiles,
      () => readSettings.maxReadLines
    ),
    allProviders,
    createProvider: (id: ProviderId) => registry.create(id),
    setMaxReadLines: (lines: number) => {
      readSettings.maxReadLines = lines;
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
