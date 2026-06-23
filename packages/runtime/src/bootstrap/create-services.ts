import { PromptAttachmentService } from '@core/application/prompt-attachment-service';
import { ChatSessionService } from '@core/application/chat-session-service';
import { ListModelsService } from '@core/application/list-models-service';
import { ToolRegistry } from '@core/application/tool-registry';
import { ProviderId, type ProviderClient } from '@core/ports/chat-model';
import { WriteFileTool } from '@runtime/tools/write-file-tool';
import { ProviderRegistry } from '@runtime/bootstrap/provider-registry';
import { loadAppConfig } from '@runtime/config/app-config';
import { FileConversationRepository } from '@runtime/persistence/file-conversation-repository';
import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OpenAiProvider } from '@providers/openai/openai-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import type { AppConfig } from '@runtime/config/app-config';

export interface RuntimeServices {
  providerId: ProviderId;
  chatSessionService: ChatSessionService;
  listModelsService: ListModelsService;
  promptAttachmentService: PromptAttachmentService;
  allProviders: ProviderClient[];
  createProvider: (id: ProviderId) => ProviderClient;
}

export interface CreateRuntimeOptions {
  providerId?: ProviderId;
  env?: NodeJS.ProcessEnv;
}

export function createRuntimeServices(
  options: CreateRuntimeOptions = {}
): RuntimeServices {
  const config = loadAppConfig(options.env);
  const providerId = options.providerId ?? config.defaultProvider;
  const registry = new ProviderRegistry(config);
  const provider = registry.create(providerId);
  const repository = new FileConversationRepository(config.sessionsDirectory);
  const workspaceRoot = process.cwd();
  const workspaceFiles = new LocalWorkspaceFileService(workspaceRoot);
  const toolRegistry = new ToolRegistry([new WriteFileTool(workspaceFiles)]);
  const allProviders = createAllProviders(config);

  return {
    providerId,
    chatSessionService: new ChatSessionService(repository, provider, {
      toolRegistry,
      workspaceRoot,
    }),
    listModelsService: new ListModelsService(provider),
    promptAttachmentService: new PromptAttachmentService(workspaceFiles),
    allProviders,
    createProvider: (id: ProviderId) => registry.create(id),
  };
}

function createAllProviders(config: AppConfig): ProviderClient[] {
  const providers: ProviderClient[] = [
    new OllamaProvider(config.ollama.baseUrl),
    new LmStudioProvider(config.lmstudio.baseUrl),
  ];

  if (config.openai.apiKey) {
    providers.push(
      new OpenAiProvider(
        config.openai.apiKey,
        config.openai.baseUrl,
        config.openai.defaultModel
      )
    );
  }

  if (config.openrouter.apiKey) {
    providers.push(
      new OpenRouterProvider(
        config.openrouter.apiKey,
        config.openrouter.baseUrl
      )
    );
  }

  return providers;
}
