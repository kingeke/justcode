import { describe, expect, it } from 'vitest';
import { AgentSendMode } from '@providers/agent-send-mode';

describe('AgentSendMode', () => {
  it('preserves wire values', () => {
    expect(AgentSendMode.Session).toBe('session');
    expect(AgentSendMode.Ephemeral).toBe('ephemeral');
  });
});
