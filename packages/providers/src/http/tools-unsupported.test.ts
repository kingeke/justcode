import { describe, expect, it } from 'vitest';

import { HttpError } from '@providers/http/http-client';
import {
  isToolsUnsupportedError,
  recommendsResponsesApi,
} from '@providers/http/tools-unsupported';

describe('isToolsUnsupportedError', () => {
  it('matches OpenRouter 404 "No endpoints found that support tool use"', () => {
    const error = new HttpError(
      'failed',
      404,
      'No endpoints found that support tool use. Try disabling "lazy_load_tools".'
    );

    expect(isToolsUnsupportedError(error)).toBe(true);
  });

  it('matches an OpenAI-compatible 400 "does not support tools"', () => {
    const error = new HttpError(
      'failed',
      400,
      '{"error":{"message":"registry.ollama.ai/library/llama3 does not support tools"}}'
    );

    expect(isToolsUnsupportedError(error)).toBe(true);
  });

  it('matches a "function calling is not supported" body', () => {
    const error = new HttpError(
      'failed',
      400,
      'function calling is not supported for this model'
    );

    expect(isToolsUnsupportedError(error)).toBe(true);
  });

  it('does not match a body that only recommends the Responses API', () => {
    const error = new HttpError(
      'failed',
      400,
      'Function tools with reasoning_effort are not supported for gpt-5.4 in /v1/chat/completions. Please use /v1/responses instead.'
    );

    expect(isToolsUnsupportedError(error)).toBe(false);
  });

  it('ignores unrelated statuses, bodies, and non-HTTP errors', () => {
    expect(isToolsUnsupportedError(new HttpError('failed', 500, 'boom'))).toBe(
      false
    );
    expect(
      isToolsUnsupportedError(new HttpError('failed', 404, 'model not found'))
    ).toBe(false);
    expect(isToolsUnsupportedError(new Error('does not support tools'))).toBe(
      false
    );
  });
});

describe('recommendsResponsesApi', () => {
  it('detects the Responses API hints', () => {
    expect(recommendsResponsesApi('unsupported_api_for_model')).toBe(true);
    expect(
      recommendsResponsesApi(
        'this model is not accessible via the /chat/completions api'
      )
    ).toBe(true);
    expect(recommendsResponsesApi('please use /v1/responses')).toBe(true);
    expect(recommendsResponsesApi('/responses instead')).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(recommendsResponsesApi('some other failure')).toBe(false);
  });
});
