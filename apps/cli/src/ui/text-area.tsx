import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';

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

function renderLine(
  line: string,
  isCursorLine: boolean,
  cursorColumn: number
): React.JSX.Element {
  if (!isCursorLine) {
    return <Text>{line}</Text>;
  }

  if (line.length === 0) {
    return <Text>{chalk.inverse(' ')}</Text>;
  }

  const before = line.slice(0, cursorColumn);
  const cursorChar = line.slice(cursorColumn, cursorColumn + 1);
  const after = line.slice(cursorColumn + 1);

  return (
    <Text>
      {before}
      {cursorChar ? chalk.inverse(cursorChar) : chalk.inverse(' ')}
      {after}
    </Text>
  );
}

export function TextArea({
  value,
  placeholder = '',
  focus = true,
  onChange,
  onSubmit,
}: TextAreaProps): React.JSX.Element {
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

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') return;
      if (key.tab) return;
      if (key.escape) return;

      let nextOffset = state.offset;
      let nextValue = value;

      if (key.return) {
        if (key.shift) {
          nextValue =
            value.slice(0, state.offset) +
            '\n' +
            value.slice(state.offset, value.length);
          nextOffset = state.offset + 1;
        } else if (onSubmit) {
          onSubmit(value);
          return;
        }
      } else if (key.ctrl && input === 'j') {
        nextValue =
          value.slice(0, state.offset) +
          '\n' +
          value.slice(state.offset, value.length);
        nextOffset = state.offset + 1;
      } else if (key.leftArrow) {
        nextOffset = state.offset - 1;
      } else if (key.rightArrow) {
        nextOffset = state.offset + 1;
      } else if (key.upArrow) {
        const lineStart = lineStartOf(value, state.offset);
        if (lineStart === 0) {
          nextOffset = 0;
        } else {
          const prevLineEnd = lineStart - 1;
          const prevLineStart = lineStartOf(value, prevLineEnd);
          const targetColumn = columnOf(value, state.offset);
          nextOffset = Math.min(prevLineStart + targetColumn, prevLineEnd);
        }
      } else if (key.downArrow) {
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
      } else if (key.backspace || key.delete) {
        if (state.offset > 0) {
          nextValue =
            value.slice(0, state.offset - 1) +
            value.slice(state.offset, value.length);
          nextOffset = state.offset - 1;
        }
      } else if (input && !key.meta) {
        nextValue =
          value.slice(0, state.offset) +
          input +
          value.slice(state.offset, value.length);
        nextOffset = state.offset + input.length;
      }

      nextOffset = clampOffset(
        value === nextValue ? value : nextValue,
        nextOffset
      );

      setState({ offset: nextOffset });
      if (nextValue !== value) {
        onChange(nextValue);
      }
    },
    { isActive: focus }
  );

  const lines = value.length === 0 ? [''] : value.split('\n');
  const cursorLine = lineIndexOf(value, state.offset);
  const cursorColumn = columnOf(value, state.offset);

  if (!focus) {
    return (
      <Box flexDirection="column">
        {value.length === 0 && placeholder ? (
          <Text>{chalk.grey(placeholder)}</Text>
        ) : (
          lines.map((line, index) => <Text key={index}>{line}</Text>)
        )}
      </Box>
    );
  } else if (value.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          {placeholder
            ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
            : chalk.inverse(' ')}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          {renderLine(line, index === cursorLine, cursorColumn)}
        </React.Fragment>
      ))}
    </Box>
  );
}
