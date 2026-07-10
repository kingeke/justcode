import { describe, expect, it } from 'vitest';
import {
  BUILD_MODE_ID,
  BUILT_IN_MODES,
  CUSTOM_MODE_ICON,
  ModeIcon,
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

describe('ModeIcon', () => {
  it('has stable string values', () => {
    expect(ModeIcon.Build).toBe('build');
    expect(ModeIcon.Ask).toBe('ask');
    expect(ModeIcon.Plan).toBe('plan');
    expect(ModeIcon.Custom).toBe('custom');
  });

  it('built-in modes use the matching enum icons', () => {
    const icons = BUILT_IN_MODES.map((m) => m.icon);
    expect(icons).toEqual([ModeIcon.Build, ModeIcon.Ask, ModeIcon.Plan]);
    expect(CUSTOM_MODE_ICON).toBe(ModeIcon.Custom);
    expect(
      listModes({ x: { name: 'X' } }).find((m) => m.id === 'x')?.icon
    ).toBe(ModeIcon.Custom);
  });
});
