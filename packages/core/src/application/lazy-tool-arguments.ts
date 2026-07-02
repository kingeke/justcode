/**
 * The `enable`/`disable` toggle lists of a `lazy_load_tools` call, parsed
 * leniently: malformed JSON or wrong-shaped fields yield empty lists (which
 * callers treat as a catalog request) rather than an error, since models
 * sometimes pass stray arguments and bouncing the turn helps nobody.
 *
 * Lives in core because both the runtime tool (standalone fallback) and the
 * chat session service (the real, session-state-aware handler) parse the same
 * call shape, and core cannot import from runtime.
 */
export function parseLazyLoadArguments(rawArguments: string): {
  enable: string[];
  disable: string[];
} {
  const onlyStrings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  if (!rawArguments.trim()) {
    return { enable: [], disable: [] };
  }
  try {
    const parsed = JSON.parse(rawArguments) as {
      enable?: unknown;
      disable?: unknown;
    };
    return {
      enable: onlyStrings(parsed.enable),
      disable: onlyStrings(parsed.disable),
    };
  } catch {
    return { enable: [], disable: [] };
  }
}
