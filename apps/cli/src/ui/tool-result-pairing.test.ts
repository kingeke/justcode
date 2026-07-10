import { describe, expect, it } from 'vitest';

import { MessageRole, type ChatMessage } from '@core/domain/message';
import { ToolName } from '@core/domain/tool-name';
import {
  pairedToolResultIds,
  toolResultsByCallId,
} from '@cli/ui/tool-result-pairing';

const CREATED_AT = new Date(0).toISOString();

function assistant(
  id: string,
  calls: { id: string; name: ToolName }[]
): ChatMessage {
  return {
    id,
    role: MessageRole.Assistant,
    content: '',
    createdAt: CREATED_AT,
    toolCalls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: '{}',
    })),
  };
}

function toolResult(
  id: string,
  toolCallId: string,
  content: string
): ChatMessage {
  return {
    id,
    role: MessageRole.Tool,
    name: ToolName.ReadFile,
    toolCallId,
    content,
    createdAt: CREATED_AT,
  };
}

describe('tool result pairing', () => {
  // The shape a finished parallel turn commits as: one assistant message with
  // both calls, then both results.
  const parallelTurn: ChatMessage[] = [
    assistant('a1', [
      { id: 'call-1', name: ToolName.ReadFile },
      { id: 'call-2', name: ToolName.ReadFile },
    ]),
    toolResult('t1', 'call-1', 'README.md'),
    toolResult('t2', 'call-2', 'package.json'),
  ];

  it('keys each result by the call that produced it', () => {
    const results = toolResultsByCallId(parallelTurn);
    expect(results.get('call-1')?.id).toBe('t1');
    expect(results.get('call-2')?.id).toBe('t2');
  });

  it('marks every matched result as paired, so it renders under its call', () => {
    const results = toolResultsByCallId(parallelTurn);
    expect(pairedToolResultIds(parallelTurn, results)).toEqual(
      new Set(['t1', 't2'])
    );
  });

  it('leaves a result without its assistant message unpaired', () => {
    // An older session may hold the result but not the call; it must still
    // render on its own rather than vanish from the transcript.
    const orphan = [toolResult('t9', 'call-9', 'output')];
    const results = toolResultsByCallId(orphan);
    expect(pairedToolResultIds(orphan, results).size).toBe(0);
  });

  it('pairs the streaming shape too: one call per assistant message', () => {
    const streamed: ChatMessage[] = [
      assistant('a1', [{ id: 'call-1', name: ToolName.ReadFile }]),
      toolResult('t1', 'call-1', 'README.md'),
      assistant('a2', [{ id: 'call-2', name: ToolName.ReadFile }]),
      toolResult('t2', 'call-2', 'package.json'),
    ];
    const results = toolResultsByCallId(streamed);
    expect(pairedToolResultIds(streamed, results)).toEqual(
      new Set(['t1', 't2'])
    );
  });

  it('ignores a call whose result has not arrived yet (still running)', () => {
    const running: ChatMessage[] = [
      assistant('a1', [
        { id: 'call-1', name: ToolName.ReadFile },
        { id: 'call-2', name: ToolName.ReadFile },
      ]),
      toolResult('t1', 'call-1', 'README.md'),
    ];
    const results = toolResultsByCallId(running);
    expect(results.has('call-2')).toBe(false);
    expect(pairedToolResultIds(running, results)).toEqual(new Set(['t1']));
  });
});
