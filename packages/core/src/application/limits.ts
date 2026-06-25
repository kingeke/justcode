/**
 * Default per-file byte cap applied when reading file content into the model's
 * context — used by both the `read_file` tool and `@`-mention attachments so the
 * limit is identical across the board. It is a default only: the runtime
 * overrides it from user config (see `create-services`/`create-cli`).
 */
export const DEFAULT_MAX_READ_BYTES = 2 * 1024;
