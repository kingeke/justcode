import { HttpError } from '@providers/http/http-client';

/**
 * Detects a provider error that means the model can't do tool/function calling,
 * so the agent loop can retry the turn in chat-only mode. Matched on the
 * response body so unrelated failures aren't misclassified.
 *
 * Covers both the 400s returned by OpenAI-compatible servers (e.g. Ollama's
 * "<model> does not support tools") and OpenRouter's 404 "No endpoints found
 * that support tool use", which it returns when no upstream provider for the
 * requested model can serve a request carrying `tools`.
 */
export function isToolsUnsupportedError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  if (error.status !== 400 && error.status !== 404) return false;

  const body = error.responseText.toLowerCase();
  // Some models reject tools only on /chat/completions and tell us to use
  // /responses instead (see recommendsResponsesApi). That's a routing problem,
  // not a missing capability — the model DOES support tools — so don't
  // misclassify it here and permanently flag the model tool-unsupported.
  if (recommendsResponsesApi(body)) {
    return false;
  }
  return (
    body.includes('does not support tools') ||
    body.includes('does not support tool') ||
    body.includes('support tool use') ||
    (body.includes('tool') && body.includes('not supported')) ||
    (body.includes('function calling') && body.includes('not'))
  );
}

/**
 * True when a 400 body says the request can't be served on /chat/completions and
 * points to the Responses API instead. Covers both the bare
 * `unsupported_api_for_model` case and the more specific one where only a feature
 * combination is rejected (e.g. Copilot's "Function tools with reasoning_effort
 * are not supported for gpt-5.4 in /v1/chat/completions. Please use /v1/responses
 * instead.") — in every case the fix is to retry on /responses.
 */
export function recommendsResponsesApi(lowerCaseBody: string): boolean {
  return (
    lowerCaseBody.includes('unsupported_api_for_model') ||
    lowerCaseBody.includes('not accessible via the /chat/completions') ||
    lowerCaseBody.includes('use /v1/responses') ||
    lowerCaseBody.includes('use the /responses') ||
    lowerCaseBody.includes('/responses instead')
  );
}
