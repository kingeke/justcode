import { ChatSessionService } from '@core/application/chat-session-service';
import { ListModelsService } from '@core/application/list-models-service';
import type { ProviderId } from '@core/ports/chat-model';
import { ProviderRegistry } from '@runtime/bootstrap/provider-registry';
import { loadAppConfig } from '@runtime/config/app-config';
import { FileConversationRepository } from '@runtime/persistence/file-conversation-repository';

export interface RuntimeServices {
  providerId: ProviderId;
  chatSessionService: ChatSessionService;
  listModelsService: ListModelsService;
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
  const provider = new ProviderRegistry(config).create(providerId);
  const repository = new FileConversationRepository(config.sessionsDirectory);

  return {
    providerId,
    chatSessionService: new ChatSessionService(repository, provider),
    listModelsService: new ListModelsService(provider),
  };
}
