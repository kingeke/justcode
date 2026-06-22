import type { ModelInfo, ProviderClient } from '@core/ports/chat-model';

export class ListModelsService {
  public constructor(private readonly provider: ProviderClient) {}

  public async execute(): Promise<ModelInfo[]> {
    return this.provider.listModels();
  }
}
