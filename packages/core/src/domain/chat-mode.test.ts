import { describe, expect, it } from 'vitest';
import {
  BUILD_MODE_ID,
  addCustomMode,
  listModes,
  removeCustomMode,
} from '@core/domain/chat-mode';

describe('custom modes', () => {
  it('adds a custom mode with a unique id', () => {
    const created = addCustomMode('Review', 'review prompt');
    expect(created).not.toBeNull();
    expect(created?.customModes[created.id]?.name).toBe('Review');
    expect(
      listModes(created?.customModes).some((m) => m.id === created?.id)
    ).toBe(true);
  });

  it('removes a custom mode without mutating the input map', () => {
    const created = addCustomMode('Review', undefined);
    expect(created).not.toBeNull();
    if (!created) return;

    const removed = removeCustomMode(created.id, created.customModes);
    expect(removed).not.toBeNull();
    expect(removed?.customModes[created.id]).toBeUndefined();
    // Input untouched.
    expect(created.customModes[created.id]).toBeDefined();
  });

  it('refuses to remove built-in or unknown modes', () => {
    const created = addCustomMode('Review', undefined);
    expect(removeCustomMode(BUILD_MODE_ID, created?.customModes)).toBeNull();
    expect(removeCustomMode('nope', created?.customModes)).toBeNull();
    expect(removeCustomMode('anything', {})).toBeNull();
  });
});
