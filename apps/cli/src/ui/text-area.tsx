import React, { useEffect, useState } from 'react';
import {
  StyledText,
  createTextAttributes,
  type KeyEvent,
  type TextChunk,
} from '@opentui/core';
import { useKeyboard } from '@opentui/react';

export interface TextAreaProps {
  readonly value: string;
  readonly placeholder?: string;
  readonly focus?: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
}

interface CursorState {
  offset: number;
}

const INVERSE = createTextAttributes({ inverse: true });
const DIM = createTextAttributes({ dim: true });

function clampOffset(value: string, offset: number): number {
  if (offset < 0) return 0;
  if (offset > value.length) return value.length;
  return offset;
}

function lineStartOf(value: string, offset: number): number {
  const index = value.lastIndexOf('\n', offset - 1);
  return index === -1 ? 0 : index + 1;
}

function lineEndOf(value: string, offset: number): number {
  const index = value.indexOf('\n', offset);
  return index === -1 ? value.length : index;
}

function columnOf(value: string, offset: number): number {
  return offset - lineStartOf(value, offset);
}

function lineIndexOf(value: string, offset: number): number {
  return value.slice(0, offset).split('\n').length - 1;
}

function chunk(text: string, attributes?: number): TextChunk {
  const result: TextChunk = { __isChunk: true, text };
  if (attributes) result.attributes = attributes;
  return result;
}

// A plain (unstyled) line. We always feed <text> a StyledText via `content` —
// never children — because OpenTUI crashes if a <text> instance ever switches
// between a `content` prop and children (it sets content to null in between).
function plainLineContent(line: string): StyledText {
  return new StyledText([chunk(line === '' ? ' ' : line)]);
}

// Renders the cursor as an inverse-styled cell, mirroring the previous
// chalk.inverse() behaviour but as OpenTUI styled chunks.
function cursorLineContent(line: string, cursorColumn: number): StyledText {
  if (line.length === 0) {
    return new StyledText([chunk(' ', INVERSE)]);
  }

  const before = line.slice(0, cursorColumn);
  const cursorChar = line.slice(cursorColumn, cursorColumn + 1);
  const after = line.slice(cursorColumn + 1);

  const chunks: TextChunk[] = [];
  if (before) chunks.push(chunk(before));
  chunks.push(chunk(cursorChar || ' ', INVERSE));
  if (after) chunks.push(chunk(after));
  return new StyledText(chunks);
}

// True when the key event represents a literal character to insert.
function printableInput(key: KeyEvent): string | undefined {
  if (key.ctrl || key.meta) return undefined;
  const sequence = key.sequence;
  if (!sequence) return undefined;
  for (const char of sequence) {
    if (char < ' ' || char === '\x7f') return undefined;
  }
  return sequence;
}

export function TextArea({
  value,
  placeholder = '',
  focus = true,
  onChange,
  onSubmit,
}: TextAreaProps): React.ReactNode {
  const [state, setState] = useState<CursorState>({
    offset: (value || '').length,
  });

  useEffect(() => {
    setState((previous) => {
      if (!focus) return previous;
      const newValue = value || '';
      if (previous.offset > newValue.length) {
        return { offset: newValue.length };
      }
      return previous;
    });
  }, [value, focus]);

  useKeyboard((key) => {
    if (!focus) return;
    if (key.ctrl && key.name === 'c') return;
    if (key.name === 'tab') return;
    if (key.name === 'escape') return;

    let nextOffset = state.offset;
    let nextValue = value;

    if (key.name === 'return') {
      if (key.shift) {
        nextValue =
          value.slice(0, state.offset) +
          '\n' +
          value.slice(state.offset, value.length);
        nextOffset = state.offset + 1;
      } else if (onSubmit) {
        onSubmit(value);
        return;
      } else {
        return;
      }
    } else if (key.ctrl && key.name === 'j') {
      nextValue =
        value.slice(0, state.offset) +
        '\n' +
        value.slice(state.offset, value.length);
      nextOffset = state.offset + 1;
    } else if (key.name === 'left') {
      nextOffset = state.offset - 1;
    } else if (key.name === 'right') {
      nextOffset = state.offset + 1;
    } else if (key.name === 'up') {
      const lineStart = lineStartOf(value, state.offset);
      if (lineStart === 0) {
        nextOffset = 0;
      } else {
        const prevLineEnd = lineStart - 1;
        const prevLineStart = lineStartOf(value, prevLineEnd);
        const targetColumn = columnOf(value, state.offset);
        nextOffset = Math.min(prevLineStart + targetColumn, prevLineEnd);
      }
    } else if (key.name === 'down') {
      const lineEnd = lineEndOf(value, state.offset);
      if (lineEnd === value.length) {
        nextOffset = value.length;
      } else {
        const nextLineStart = lineEnd + 1;
        const nextLineEnd = lineEndOf(value, nextLineStart);
        const targetColumn = columnOf(value, state.offset);
        const maxColumn = nextLineEnd - nextLineStart;
        nextOffset = nextLineStart + Math.min(targetColumn, maxColumn);
      }
    } else if (key.name === 'backspace' || key.name === 'delete') {
      if (state.offset > 0) {
        nextValue =
          value.slice(0, state.offset - 1) +
          value.slice(state.offset, value.length);
        nextOffset = state.offset - 1;
      }
    } else {
      const input = printableInput(key);
      if (input) {
        nextValue =
          value.slice(0, state.offset) +
          input +
          value.slice(state.offset, value.length);
        nextOffset = state.offset + input.length;
      }
    }

    nextOffset = clampOffset(
      value === nextValue ? value : nextValue,
      nextOffset
    );

    setState({ offset: nextOffset });
    if (nextValue !== value) {
      onChange(nextValue);
    }
  });

  const lines = value.length === 0 ? [''] : value.split('\n');
  const cursorLine = lineIndexOf(value, state.offset);
  const cursorColumn = columnOf(value, state.offset);

  if (!focus) {
    const content =
      value.length === 0 && placeholder
        ? new StyledText([chunk(placeholder, DIM)])
        : null;
    return (
      <box flexDirection="column">
        {content ? (
          <text content={content} />
        ) : (
          lines.map((line, index) => (
            <text key={index} content={plainLineContent(line)} />
          ))
        )}
      </box>
    );
  }

  if (value.length === 0) {
    const content = placeholder
      ? new StyledText([
          chunk(placeholder[0] ?? ' ', INVERSE),
          chunk(placeholder.slice(1), DIM),
        ])
      : new StyledText([chunk(' ', INVERSE)]);
    return (
      <box flexDirection="column">
        <text content={content} />
      </box>
    );
  }

  return (
    <box flexDirection="column">
      {lines.map((line, index) => (
        <text
          key={index}
          content={
            index === cursorLine
              ? cursorLineContent(line, cursorColumn)
              : plainLineContent(line)
          }
        />
      ))}
    </box>
  );
}
