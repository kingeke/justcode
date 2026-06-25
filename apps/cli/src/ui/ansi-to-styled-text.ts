import {
  RGBA,
  StyledText,
  createTextAttributes,
  stringToStyledText,
  type TextChunk,
} from '@opentui/core';

// OpenTUI's <text> renders StyledText (TextChunk[]) and does NOT interpret raw
// ANSI escape codes. The markdown/diff/syntax pipeline (marked-terminal + shiki +
// chalk) emits ANSI strings, so this adapter parses SGR sequences into TextChunks
// so that pre-rendered ANSI content keeps its colors/styles inside OpenTUI.

// Matches a single SGR sequence: ESC [ <params> m
// eslint-disable-next-line no-control-regex
const SGR_PATTERN = /\x1b\[([0-9;]*)m/g;

// Strips any non-SGR escape sequence (OSC hyperlinks, cursor moves, etc.) so that
// stray control bytes never leak into rendered text as visible garbage. The CSI
// branch uses a final-byte class of `[@-ln-~]` (0x40–0x6C, 0x6E–0x7E) which spans
// all CSI terminators EXCEPT `m` (0x6D), leaving SGR colour sequences intact.
// eslint-disable-next-line no-control-regex
const NON_SGR_ESCAPE =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[@-ln-~]/g;

interface SgrState {
  fg: RGBA | undefined;
  bg: RGBA | undefined;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

function freshState(): SgrState {
  return {
    fg: undefined,
    bg: undefined,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strikethrough: false,
  };
}

function attributesFor(state: SgrState): number {
  return createTextAttributes({
    bold: state.bold,
    dim: state.dim,
    italic: state.italic,
    underline: state.underline,
    inverse: state.inverse,
    strikethrough: state.strikethrough,
  });
}

function chunkFor(text: string, state: SgrState): TextChunk {
  const chunk: TextChunk = { __isChunk: true, text };
  if (state.fg) chunk.fg = state.fg;
  if (state.bg) chunk.bg = state.bg;
  const attributes = attributesFor(state);
  if (attributes) chunk.attributes = attributes;
  return chunk;
}

// Applies one SGR sequence (its semicolon-separated numeric params) to the state.
// The 38/48 extended-color forms consume several params, so we walk with an index.
function applySgr(params: number[], state: SgrState): void {
  if (params.length === 0) {
    params = [0];
  }

  for (let i = 0; i < params.length; i++) {
    const code = params[i] ?? 0;

    if (code === 0) {
      Object.assign(state, freshState());
    } else if (code === 1) state.bold = true;
    else if (code === 2) state.dim = true;
    else if (code === 3) state.italic = true;
    else if (code === 4) state.underline = true;
    else if (code === 7) state.inverse = true;
    else if (code === 9) state.strikethrough = true;
    else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) state.italic = false;
    else if (code === 24) state.underline = false;
    else if (code === 27) state.inverse = false;
    else if (code === 29) state.strikethrough = false;
    else if (code >= 30 && code <= 37) state.fg = RGBA.fromIndex(code - 30);
    else if (code >= 90 && code <= 97) state.fg = RGBA.fromIndex(code - 90 + 8);
    else if (code >= 40 && code <= 47) state.bg = RGBA.fromIndex(code - 40);
    else if (code >= 100 && code <= 107)
      state.bg = RGBA.fromIndex(code - 100 + 8);
    else if (code === 39) state.fg = undefined;
    else if (code === 49) state.bg = undefined;
    else if (code === 38 || code === 48) {
      const mode = params[i + 1];
      if (mode === 5) {
        const index = params[i + 2] ?? 0;
        const color = RGBA.fromIndex(index);
        if (code === 38) state.fg = color;
        else state.bg = color;
        i += 2;
      } else if (mode === 2) {
        const r = params[i + 2] ?? 0;
        const g = params[i + 3] ?? 0;
        const b = params[i + 4] ?? 0;
        const color = RGBA.fromInts(r, g, b, 255);
        if (code === 38) state.fg = color;
        else state.bg = color;
        i += 4;
      }
    }
    // Other codes (blink, conceal, etc.) are intentionally ignored.
  }
}

/**
 * Converts an ANSI/SGR-formatted string into an OpenTUI StyledText. Plain strings
 * (no escapes) round-trip through stringToStyledText so callers can pass either.
 */
export function ansiToStyledText(input: string): StyledText {
  if (!input.includes('\x1b')) {
    return stringToStyledText(input);
  }

  const text = input.replace(NON_SGR_ESCAPE, '');
  const state = freshState();
  const chunks: TextChunk[] = [];

  let lastIndex = 0;
  SGR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      if (segment) chunks.push(chunkFor(segment, state));
    }
    const params = (match[1] ?? '')
      .split(';')
      .filter((part) => part.length > 0)
      .map((part) => Number.parseInt(part, 10));
    applySgr(params, state);
    lastIndex = SGR_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex);
    if (segment) chunks.push(chunkFor(segment, state));
  }

  if (chunks.length === 0) {
    chunks.push({ __isChunk: true, text: '' });
  }

  return new StyledText(chunks);
}
