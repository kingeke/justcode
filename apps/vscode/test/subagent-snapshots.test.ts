import { describe, expect, it } from 'vitest';

import { createConversation } from '@core/domain/conversation';
import { createMessage, MessageRole } from '@core/domain/message';
import {
  SubAgentRunStatus,
  SubAgentType,
  type SubAgentRun,
} from '@core/domain/sub-agent';
import { toSubAgentSnapshots } from '@ext/host/chat-bridge';
import { WebviewSubAgentStatus } from '@ext/shared/protocol';

describe('toSubAgentSnapshots', () => {
  it('summarizes persisted runs for the Ready snapshot', () => {
    const run: SubAgentRun = {
      id: 'call-1',
      agentType: SubAgentType.General,
      description: 'Build the CSS',
      prompt: 'Create style.css',
      status: SubAgentRunStatus.Completed,
      messages: [
        createMessage(MessageRole.User, 'Create style.css', new Date()),
        createMessage(MessageRole.Assistant, '', new Date(), undefined, {
          toolCalls: [{ id: 't1', name: 'write_file', arguments: '{}' }],
        }),
        createMessage(MessageRole.Tool, 'ok', new Date(), undefined, {
          toolCallId: 't1',
          name: 'write_file',
        }),
        createMessage(MessageRole.Assistant, 'Done.', new Date()),
      ],
      startedAt: '2026-07-07T18:00:00.000Z',
      endedAt: '2026-07-07T18:01:00.000Z',
      summary: 'Created style.css',
    };
    const conversation = createConversation('s1');
    conversation.subAgentRuns = [run];

    const snapshots = toSubAgentSnapshots(conversation);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({
      runId: 'call-1',
      agentType: SubAgentType.General,
      description: 'Build the CSS',
      status: WebviewSubAgentStatus.Completed,
      toolUseCount: 1,
      summary: 'Created style.css',
      startedAt: Date.parse(run.startedAt),
      endedAt: Date.parse(run.endedAt!),
    });
  });

  it('returns an empty list for conversations without sub agent runs', () => {
    expect(toSubAgentSnapshots(createConversation('s1'))).toEqual([]);
  });
});
