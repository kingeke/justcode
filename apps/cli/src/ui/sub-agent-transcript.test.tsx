import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  summarizeToolArgs,
  toolResultSummary,
  transcriptMessages,
} from '@cli/ui/sub-agent-transcript-helpers.js';
import { createMessage, MessageRole } from '@core/domain/message';
import {
  SubAgentRunStatus,
  SubAgentType,
  type SubAgentRun,
} from '@core/domain/sub-agent';

function makeRun(): SubAgentRun {
  return {
    id: 'call-1',
    agentType: SubAgentType.Explorer,
    description: 'Find the auth bug',
    prompt: 'Find the auth bug and report it.',
    status: SubAgentRunStatus.Completed,
    startedAt: '2026-07-07T00:00:00.000Z',
    endedAt: '2026-07-07T00:01:00.000Z',
    messages: [
      createMessage(MessageRole.System, 'You are an explorer.'),
      createMessage(MessageRole.User, 'Find the auth bug and report it.'),
      createMessage(MessageRole.Assistant, '', new Date(), undefined, {
        toolCalls: [{ id: 't1', name: 'grep', arguments: '{"path":"src"}' }],
      }),
      createMessage(
        MessageRole.Tool,
        'found it\nmore detail',
        new Date(),
        undefined,
        {
          toolCallId: 't1',
          name: 'grep',
        }
      ),
      createMessage(MessageRole.Assistant, 'The bug is in auth.ts.'),
    ],
    summary: 'The bug is in auth.ts.',
  };
}

describe('transcriptMessages', () => {
  it('drops the system prompt but keeps the rest of the run in order', () => {
    const messages = transcriptMessages(makeRun());
    expect(messages).toHaveLength(4);
    expect(messages.every((m) => m.role !== MessageRole.System)).toBe(true);
    expect(messages[0]?.role).toBe(MessageRole.User);
    expect(messages.at(-1)?.content).toBe('The bug is in auth.ts.');
  });
});

describe('summarizeToolArgs', () => {
  it('prefers a path argument', () => {
    expect(summarizeToolArgs('{"path":"src/app.ts","limit":5}')).toBe(
      'src/app.ts'
    );
  });

  it('falls back to the argument keys', () => {
    expect(summarizeToolArgs('{"pattern":"x","literal":true}')).toBe(
      'pattern, literal'
    );
  });

  it('truncates unparseable arguments', () => {
    expect(summarizeToolArgs('not json '.repeat(10))).toHaveLength(41);
  });
});

describe('toolResultSummary', () => {
  it('keeps only the first line, truncated', () => {
    expect(toolResultSummary('line one\nline two')).toBe('line one');
    expect(toolResultSummary('x'.repeat(200))).toHaveLength(101);
  });
});

describe('sub agent transcript view', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/sub-agent-transcript.tsx'),
    'utf8'
  );

  it('shows the header and keyboard hints', () => {
    expect(source).toContain("tc('sub agent · '");
    expect(source).toContain('↑/↓ scroll · esc back');
  });

  it('closes on Escape and refreshes while the run is still running', () => {
    expect(source).toContain('KeyName.Escape');
    expect(source).toContain('SubAgentRunStatus.Running');
    expect(source).toContain('setInterval');
  });
});

describe('chat-app sub agent browsing', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/chat-app.tsx'),
    'utf8'
  );

  it('supports arrow-key browsing of the panel and Enter to open a run', () => {
    expect(source).toContain('subAgentBrowseIndex');
    expect(source).toContain('setOpenSubAgentRunId(entry.runId)');
    expect(source).toContain('↑/↓ select · enter view transcript · esc back');
  });

  it('serves transcripts from the live run map, then the persisted runs', () => {
    expect(source).toContain('subAgentRunsRef.current.get(openSubAgentRunId)');
    expect(source).toContain('conversation?.subAgentRuns?.find');
  });
});
