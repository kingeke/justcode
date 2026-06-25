import { PromptAttachmentService } from '@core/application/prompt-attachment-service';
import { ChatSessionService } from '@core/application/chat-session-service';
import { ListModelsService } from '@core/application/list-models-service';
import { ToolRegistry } from '@core/application/tool-registry';
import { type ProviderClient } from '@core/ports/chat-model';
import { ProviderId, PROVIDERS } from '@core/ports/provider-catalog';
import { WriteFileTool } from '@runtime/tools/write-file-tool';
import { EditFileTool } from '@runtime/tools/edit-file-tool';
import {
  ReadFileTool,
  DEFAULT_MAX_READ_BYTES,
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
  /** Update, at runtime, how many bytes a single file read returns. */
  setMaxReadBytes: (bytes: number) => void;
}

export interface CreateRuntimeOptions {
  providerId?: ProviderId;
  configDirectory?: string;
  /** Initial per-read byte cap; falls back to the default when unset. */
  maxReadBytes?: number;
}

export async function createRuntimeServices(
  options: CreateRuntimeOptions = {}
): Promise<RuntimeServices> {
  const config = await loadAppConfig(options.configDirectory);
  const providerId = options.providerId ?? config.defaultProvider;
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
    maxReadBytes: options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
  };
  const toolRegistry = new ToolRegistry([
    new WriteFileTool(workspaceFiles),
    new EditFileTool(workspaceFiles),
    new ReadFileTool(workspaceFiles, () => readSettings.maxReadBytes),
  ]);
  const allProviders = createAllProviders(config);

  return {
    providerId,
    chatSessionService: new ChatSessionService(repository, provider, {
      toolRegistry,
      workspaceRoot,
    }),
    listModelsService: new ListModelsService(provider),
    promptAttachmentService: new PromptAttachmentService(
      workspaceFiles,
      () => readSettings.maxReadBytes
    ),
    allProviders,
    createProvider: (id: ProviderId) => registry.create(id),
    setMaxReadBytes: (bytes: number) => {
      readSettings.maxReadBytes = bytes;
    },
  };
}

function createAllProviders(config: AppConfig): ProviderClient[] {
  return PROVIDERS.flatMap((provider) => {
    // Only surface providers the user has actually connected. Nothing is
    // available until it has been set up via the connect screen.
    if (!config.configuredProviders.includes(provider.id)) {
      return [];
    }

    const credentials = provider.credentialsFromConfig(config);
    if (provider.apiKeyRequired && !credentials.apiKey) {
      return [];
    }

    return [provider.create(credentials)];
  });
}
