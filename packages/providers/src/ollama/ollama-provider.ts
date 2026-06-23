import {
  ProviderId,
  type ChatRequest,
  type ChatResult,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';
import {
  renderMessageContentForModel,
  type ChatMessage,
  type ToolCall,
} from '@core/domain/message';
import { toOpenAiToolDefinitions } from '@providers/openai-compatible/openai-wire';
import {
  HttpError,
  joinUrl,
  requestJson,
  requestNdjsonStream,
  type StreamResult,
} from '@providers/http/http-client';

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
  }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
    tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
  };
}

interface OllamaWireMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
}

function toOllamaWireMessages(messages: ChatMessage[]): OllamaWireMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content };
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          function: {
            name: call.name,
            arguments: safeParseArguments(call.arguments),
          },
        })),
      };
    }

    return {
      role: message.role,
      content: renderMessageContentForModel(message),
    };
  });
}

function safeParseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseOllamaToolCalls(
  raw: Array<{ function?: { name?: string; arguments?: unknown } }> | undefined
): ToolCall[] {
  if (!raw?.length) {
    return [];
  }

  return raw
    .map((call, index) => {
      const args = call.function?.arguments;
      return {
        id: `call_${index}`,
        name: call.function?.name ?? '',
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      };
    })
    .filter((call) => call.name);
}

export class OllamaProvider implements ProviderClient {
  public readonly providerId = ProviderId.Ollama;

  public constructor(private readonly baseUrl: string) {}

  public async sendChat(request: ChatRequest): Promise<ChatResult> {
    const messages = toOllamaWireMessages(request.messages);
    const tools = toOpenAiToolDefinitions(request.tools);
    const toolsBody = tools ? { tools } : {};

    if (request.onToken) {
      let accumulated = '';
      let streamResult: StreamResult = {
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        toolCalls: [],
      };
      // Ollama rejects `think: true` for models that don't support reasoning,
      // so retry without it if the first attempt is refused.
      const runStream = (think: boolean): Promise<StreamResult> =>
        requestNdjsonStream(
          joinUrl(this.baseUrl, '/api/chat'),
          {
            method: 'POST',
            body: {
              model: request.model,
              messages,
              stream: true,
              ...toolsBody,
              ...(think ? { think: true } : {}),
            },
          },
          (token) => {
            accumulated += token;
            request.onToken!(token);
          },
          request.onThinkingToken
        );

      streamResult = await runStream(true).catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 400) {
          accumulated = '';
          return runStream(false);
        }
        throw error;
      });

      if (!accumulated.trim() && streamResult.toolCalls.length === 0) {
        throw new Error('Ollama returned an empty response.');
      }

      return {
        content: accumulated,
        ...(streamResult.usage.inputTokens > 0
          ? { usage: streamResult.usage }
          : {}),
        ...(streamResult.toolCalls.length
          ? { toolCalls: streamResult.toolCalls }
          : {}),
      };
    }

    const response = await requestJson<OllamaChatResponse>(
      joinUrl(this.baseUrl, '/api/chat'),
      {
        method: 'POST',
        body: { model: request.model, messages, stream: false, ...toolsBody },
      }
    );

    const content = response.message?.content?.trim() ?? '';
    const toolCalls = parseOllamaToolCalls(response.message?.tool_calls);
    if (!content && toolCalls.length === 0) {
      throw new Error('Ollama returned an empty response.');
    }

    return {
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }

  public async listModels(): Promise<ModelInfo[]> {
    const response = await requestJson<OllamaTagsResponse>(
      joinUrl(this.baseUrl, '/api/tags')
    );

    return (response.models ?? [])
      .map((model) => ({
        id: model.name,
        displayName: model.name,
        providerId: ProviderId.Ollama,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public getDefaultModel(): string | undefined {
    return undefined;
  }
}
